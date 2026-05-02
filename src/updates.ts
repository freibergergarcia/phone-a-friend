/**
 * Update-notification module.
 *
 * Fetches the latest stable version of phone-a-friend from npm's `dist-tags.latest`,
 * caches the result at ~/.config/phone-a-friend/update-check.json, and renders a
 * stderr-only banner on the next CLI invocation if a newer version exists.
 *
 * Design notes:
 *   - Notification only — never modifies the installed package.
 *   - Cache-driven: the running invocation reads the cached snapshot to decide
 *     whether to display a banner. A detached subprocess (see
 *     `kickoffBackgroundRefresh`) performs the registry fetch and cache write
 *     so the parent command exits without waiting on the network.
 *   - Atomic writes (temp + fsync + rename + dir fsync), silent corruption
 *     rotation, bounded 5s fetch with AbortController, read-modify-write merge
 *     to avoid parent/child cache-write races.
 *   - Registry response is validated (`isValidVersionString`) before caching
 *     to defuse ANSI/newline/oversize injection from a malicious or compromised
 *     registry.
 *
 * Pure functions (decideBanner, formatBanner, schemaVersion handling) are
 * separated from side-effecting helpers (readSnapshot, writeSnapshot, fetch)
 * so unit tests can exercise the logic without filesystem or network.
 */

import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateCheckSnapshot {
  schemaVersion: 1;
  /** ISO timestamp of last successful registry fetch. Null if never fetched. */
  lastCheckedAt: string | null;
  /** Latest stable version from `dist-tags.latest`. Null if never fetched. */
  latestVersion: string | null;
  /** Version we last showed a banner for. Null if never shown. */
  lastNotifiedVersion: string | null;
  /** ISO timestamp of last banner shown. Null if never shown. */
  lastNotifiedAt: string | null;
  /** Version of phone-a-friend that last wrote the cache. */
  currentVersion: string;
}

export interface SuppressionContext {
  isStdoutTty: boolean;
  isStderrTty: boolean;
  isCi: boolean;
  isDumbTerm: boolean;
  /** True for any subcommand-level machine-readable flag (--quiet, --schema, --json on doctor/job/session/etc). */
  hasMachineFlag: boolean;
  /** Config value `defaults.update_check`. Default true. */
  configEnabled: boolean;
  /** PHONE_A_FRIEND_UPDATE_CHECK=false (or 0) was set. */
  envOptedOut: boolean;
}

export type BannerDecision =
  | { show: false; reason: string }
  | { show: true; currentVersion: string; latestVersion: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h between registry calls
export const NOTIFY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7d between same-version banners
export const FETCH_TIMEOUT_MS = 5000;
export const PACKAGE_NAME = '@freibergergarcia/phone-a-friend';
const REGISTRY_URL =
  'https://registry.npmjs.org/-/package/@freibergergarcia%2Fphone-a-friend/dist-tags';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function defaultCachePath(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  const base = env.XDG_CONFIG_HOME ?? join(home, '.config');
  return join(base, 'phone-a-friend', 'update-check.json');
}

// ---------------------------------------------------------------------------
// Snapshot I/O
// ---------------------------------------------------------------------------

function emptySnapshot(currentVersion: string): UpdateCheckSnapshot {
  return {
    schemaVersion: 1,
    lastCheckedAt: null,
    latestVersion: null,
    lastNotifiedVersion: null,
    lastNotifiedAt: null,
    currentVersion,
  };
}

export function readSnapshot(filePath: string, currentVersion: string): UpdateCheckSnapshot {
  if (!existsSync(filePath)) return emptySnapshot(currentVersion);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return emptySnapshot(currentVersion);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    rotateCorruptCache(filePath, (err as Error).message);
    return emptySnapshot(currentVersion);
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    // Unknown schema version: treat as empty and let the next refresh rebuild it.
    return emptySnapshot(currentVersion);
  }

  const snap = parsed as Partial<UpdateCheckSnapshot>;
  // Defense in depth: even though we wrote a validated string, a tampered or
  // hand-edited cache could still contain ANSI/newline payloads. Validate
  // version-shaped fields on read so nothing dangerous reaches formatBanner.
  return {
    schemaVersion: 1,
    lastCheckedAt: typeof snap.lastCheckedAt === 'string' ? snap.lastCheckedAt : null,
    latestVersion: isValidVersionString(snap.latestVersion) ? snap.latestVersion : null,
    lastNotifiedVersion:
      isValidVersionString(snap.lastNotifiedVersion) ? snap.lastNotifiedVersion : null,
    lastNotifiedAt: typeof snap.lastNotifiedAt === 'string' ? snap.lastNotifiedAt : null,
    currentVersion: isValidVersionString(snap.currentVersion)
      ? snap.currentVersion
      : currentVersion,
  };
}

function rotateCorruptCache(filePath: string, _reason: string): void {
  // Silent rotation: the cache file is fully regenerable from npm registry on
  // the next refresh, so logging the corruption to stderr would introduce
  // noise into otherwise-quiet flows (--quiet, --schema, --json, doctor --json).
  // The next write will replace the rotated file. If a user wants to inspect,
  // the .corrupt-<ts> file remains on disk.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rotated = `${filePath}.corrupt-${ts}`;
  try {
    renameSync(filePath, rotated);
  } catch {
    // Best-effort: rotation failure is harmless because the next write is atomic
    // and overwrites the file regardless.
  }
}

/**
 * Atomic write: temp file → fsync → rename → fsync parent dir.
 * Mirrors the pattern in `sessions.ts`. TODO: extract to shared helper if a
 * third caller emerges.
 */
export function writeSnapshot(filePath: string, snapshot: UpdateCheckSnapshot): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const payload = JSON.stringify(snapshot, null, 2);

  const tmpFd = openSync(tmpPath, 'w');
  try {
    try {
      writeFileSync(tmpFd, payload, 'utf-8');
      fsyncSync(tmpFd);
    } finally {
      closeSync(tmpFd);
    }
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort: temp file may already be gone.
    }
    throw err;
  }

  try {
    const dirFd = openSync(dir, 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Directory fsync isn't supported on every platform; ignore.
  }
}

// ---------------------------------------------------------------------------
// Version validation + comparison
// ---------------------------------------------------------------------------

/**
 * Accept loose semver-style version strings: digits separated by dots, with
 * an optional `-prerelease` and `+buildmetadata` suffix. Bounded to 64 chars
 * total to prevent pathological banner output. Rejects newlines, ANSI escapes,
 * and other control characters by virtue of the strict character class.
 */
const VERSION_RE = /^[0-9]+(?:\.[0-9]+){0,3}(?:-[A-Za-z0-9.\-]+)?(?:\+[A-Za-z0-9.\-]+)?$/;

export function isValidVersionString(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v.length === 0 || v.length > 64) return false;
  return VERSION_RE.test(v);
}

/** Loose semver comparator. Strips a `-prerelease` tail and compares numeric segments. */
function compareVersions(a: string, b: string): number {
  const stripPre = (v: string): number[] =>
    v.split('-')[0].split('.').map((part) => {
      const n = Number(part);
      return Number.isFinite(n) ? n : 0;
    });
  const pa = stripPre(a);
  const pb = stripPre(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Banner decision (pure)
// ---------------------------------------------------------------------------

export function decideBanner(
  snapshot: UpdateCheckSnapshot,
  currentVersion: string,
  ctx: SuppressionContext,
  nowMs: number,
): BannerDecision {
  // Cheapest checks first.
  if (ctx.envOptedOut) return { show: false, reason: 'env-opt-out' };
  if (!ctx.configEnabled) return { show: false, reason: 'config-disabled' };
  if (ctx.isCi) return { show: false, reason: 'ci' };
  if (ctx.isDumbTerm) return { show: false, reason: 'dumb-term' };
  if (!ctx.isStdoutTty || !ctx.isStderrTty) return { show: false, reason: 'no-tty' };
  if (ctx.hasMachineFlag) return { show: false, reason: 'machine-flag' };

  const latest = snapshot.latestVersion;
  if (!latest) return { show: false, reason: 'no-cache' };

  if (compareVersions(latest, currentVersion) <= 0) {
    return { show: false, reason: 'up-to-date' };
  }

  // 7-day cooldown for the same already-displayed version.
  if (
    snapshot.lastNotifiedVersion === latest &&
    snapshot.lastNotifiedAt !== null
  ) {
    const lastMs = Date.parse(snapshot.lastNotifiedAt);
    if (Number.isFinite(lastMs) && nowMs - lastMs < NOTIFY_COOLDOWN_MS) {
      return { show: false, reason: 'recently-notified' };
    }
  }

  return { show: true, currentVersion, latestVersion: latest };
}

// ---------------------------------------------------------------------------
// Banner rendering
// ---------------------------------------------------------------------------

export function formatBanner(currentVersion: string, latestVersion: string): string {
  // Plain text format — chalk styling applied at the call site in cli.ts so this
  // function stays test-friendly and color-mode-agnostic.
  return (
    `\n  ↑ phone-a-friend ${latestVersion} available (current: ${currentVersion})\n` +
    `    Run: npm install -g ${PACKAGE_NAME}@latest\n`
  );
}

// ---------------------------------------------------------------------------
// Registry fetch
// ---------------------------------------------------------------------------

export async function fetchLatestVersion(currentVersion: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref();
  }

  try {
    const resp = await fetch(REGISTRY_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': `phone-a-friend/${currentVersion} (+https://github.com/freibergergarcia/phone-a-friend)`,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return null;
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      return null;
    }
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as { latest?: unknown }).latest !== 'string'
    ) {
      return null;
    }
    const latest = (body as { latest: string }).latest;
    // Defense in depth: the registry response is trusted but we still validate
    // the string before caching/printing to avoid ANSI/newline injection or
    // pathologically long values winding up in the banner or doctor output.
    if (!isValidVersionString(latest)) return null;
    return latest;
  } catch {
    // Network error, abort, etc. — silent failure preserves the cooldown.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Background refresh
// ---------------------------------------------------------------------------

export interface ScheduleRefreshArgs {
  cachePath: string;
  currentVersion: string;
  snapshot: UpdateCheckSnapshot;
  nowMs?: number;
}

export async function scheduleRefresh(args: ScheduleRefreshArgs): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();

  // Cooldown: skip if we fetched recently.
  if (args.snapshot.lastCheckedAt) {
    const lastMs = Date.parse(args.snapshot.lastCheckedAt);
    if (Number.isFinite(lastMs) && nowMs - lastMs < CHECK_COOLDOWN_MS) {
      return;
    }
  }

  const latest = await fetchLatestVersion(args.currentVersion);
  if (!latest) {
    // Failed fetch (offline, registry 5xx, schema mismatch). Record the
    // attempt by advancing `lastCheckedAt` so offline users do not spawn a
    // detached refresh on every invocation. The cooldown applies to
    // attempts, not just successes — eventual recovery happens at the next
    // 24h boundary. `latestVersion` stays at its previous value (often null
    // on first try), so decideBanner stays "no banner".
    const current = readSnapshot(args.cachePath, args.currentVersion);
    const next: UpdateCheckSnapshot = {
      schemaVersion: 1,
      lastCheckedAt: new Date(nowMs).toISOString(),
      latestVersion: current.latestVersion,
      lastNotifiedVersion: current.lastNotifiedVersion,
      lastNotifiedAt: current.lastNotifiedAt,
      currentVersion: args.currentVersion,
    };
    try {
      writeSnapshot(args.cachePath, next);
    } catch {
      // Disk full / permission denied / etc. — silent failure. Worst case
      // we attempt again on the next invocation.
    }
    return;
  }

  // Read-modify-write: re-read the snapshot just before writing to avoid
  // clobbering `lastNotifiedVersion` / `lastNotifiedAt` that the parent process
  // may have written between our initial snapshot capture and now. This is
  // not a true cross-process lock — concurrent writers can still last-writer-wins
  // on the *merged* result — but it eliminates the field-level erase race that
  // a naive overwrite would cause.
  const current = readSnapshot(args.cachePath, args.currentVersion);
  const next: UpdateCheckSnapshot = {
    schemaVersion: 1,
    lastCheckedAt: new Date(nowMs).toISOString(),
    latestVersion: latest,
    // Preserve any notified-state the parent may have just written.
    lastNotifiedVersion: current.lastNotifiedVersion,
    lastNotifiedAt: current.lastNotifiedAt,
    currentVersion: args.currentVersion,
  };

  try {
    writeSnapshot(args.cachePath, next);
  } catch {
    // Disk full / permission denied / etc. — silent failure. We'll retry next run.
  }
}

// ---------------------------------------------------------------------------
// CLI integration helpers
// ---------------------------------------------------------------------------

/**
 * Kick off a non-blocking refresh in a detached child process. The parent
 * exits immediately; the child completes the registry fetch and writes the
 * cache. Mirrors the pattern in `update-notifier`.
 *
 * Why detached subprocess and not in-process `setImmediate().unref()`:
 * the original Phase 1 design called for an in-process refresh, but `index.ts`
 * calls `process.exit(code)` synchronously once `run()` resolves. `process.exit`
 * is forceful — it does not wait for in-flight promises (including the registry
 * fetch's open socket) to settle. That meant short-lived parent commands like
 * `phone-a-friend --version` would kill the fetch mid-flight and the cache
 * would never get populated. We could change `index.ts` to use
 * `process.exitCode = code` and let the loop drain naturally, but then
 * `--version` would block on the up-to-5s fetch timeout, which is bad UX.
 * Detached subprocess is the textbook resolution: parent exits in
 * milliseconds, child runs `phone-a-friend __update-check refresh` (a hidden
 * subcommand, recursion-guarded by `PHONE_A_FRIEND_UPDATE_REFRESH=1` so the
 * child doesn't kick off its own refresh) until the registry call completes
 * and the cache is updated for the next run.
 *
 * Falls back gracefully if spawning is impossible (no argv[1], permissions, etc.).
 */
export function kickoffBackgroundRefresh(args: {
  cachePath: string;
  currentVersion: string;
  snapshot: UpdateCheckSnapshot;
}): void {
  // Already-fresh cache: skip the spawn entirely. Saves a fork on every run
  // when the cooldown hasn't elapsed.
  if (args.snapshot.lastCheckedAt) {
    const lastMs = Date.parse(args.snapshot.lastCheckedAt);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < CHECK_COOLDOWN_MS) {
      return;
    }
  }

  const entryScript = process.argv[1];
  if (!entryScript) return;

  // Sanity-gate the spawn: only re-invoke ourselves when the entry script
  // looks like the PaF binary (or its bundled dist). Without this gate, any
  // programmatic caller — including Vitest, ts-node, or a host that imports
  // PaF as a library — could spawn its own host script with PaF subcommands.
  if (!isPafEntryScript(entryScript)) return;

  // Likewise skip when running under common test runners. Belt-and-suspenders
  // with the script-name check above; covers the case where a runner invokes
  // PaF's CLI directly under a test process.
  if (isTestRuntimeEnv(process.env)) return;

  try {
    const child = spawn(
      process.execPath,
      [entryScript, '__update-check', 'refresh'],
      {
        detached: true,
        stdio: 'ignore',
        // Recursion guard for the child — also tells it to skip its own
        // setupUpdateCheck so we don't fork-bomb.
        env: { ...process.env, PHONE_A_FRIEND_UPDATE_REFRESH: '1' },
      },
    );
    // Async ChildProcess errors (e.g. ENOENT post-spawn) are emitted as
    // 'error' events — not caught by the synchronous try/catch. Attach a
    // no-op handler so an uncaught error event doesn't crash the parent.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Synchronous spawn errors (permission, missing exec, etc.) — silent.
    // Cache will remain stale until the next successful spawn.
  }
}

/**
 * Heuristic: is the given script path our actual PaF entry point? Matches
 * the dev wrapper, the npm-published bundled entry, and the common bin
 * symlink. Rejects everything else (Vitest, Jest, ts-node, importing hosts).
 */
export function isPafEntryScript(entryScript: string): boolean {
  const normalized = entryScript.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? '';
  // Bundled / linked binary: bin/phone-a-friend or .../phone-a-friend
  if (base === 'phone-a-friend' || base === 'phone-a-friend.js') return true;
  // Bundled dist entry: .../@freibergergarcia/phone-a-friend/dist/index.js
  if (
    base === 'index.js' &&
    normalized.includes('/phone-a-friend/dist/')
  ) {
    return true;
  }
  return false;
}

/**
 * Detect common test runtimes so we don't spawn a refresh from inside a
 * test process. Test runners often set NODE_ENV=test, expose a runner-
 * specific env var, or load PaF as a module with their own argv[1]. The
 * isPafEntryScript() check covers most of this; this is the second layer.
 */
function isTestRuntimeEnv(env: NodeJS.ProcessEnv): boolean {
  if (env.PHONE_A_FRIEND_DISABLE_UPDATE_REFRESH === '1') return true;
  if (env.NODE_ENV === 'test') return true;
  if (env.VITEST || env.VITEST_WORKER_ID) return true;
  if (env.JEST_WORKER_ID) return true;
  return false;
}

/**
 * In-process variant for testing and for the detached child to call directly.
 * Awaits the fetch + cache write. Use this from inside the `__update-check refresh`
 * subcommand handler.
 */
export async function runRefresh(args: {
  cachePath: string;
  currentVersion: string;
}): Promise<void> {
  const snapshot = readSnapshot(args.cachePath, args.currentVersion);
  await scheduleRefresh({ ...args, snapshot });
}

/**
 * Mark a banner as shown by writing back the snapshot with updated
 * `lastNotifiedVersion` / `lastNotifiedAt`. Synchronous so callers can guarantee
 * the cooldown takes effect before exit.
 */
export function recordNotified(args: {
  cachePath: string;
  snapshot: UpdateCheckSnapshot;
  notifiedVersion: string;
  nowMs?: number;
}): void {
  const nowMs = args.nowMs ?? Date.now();
  // Read-modify-write: see the comment in scheduleRefresh. We re-read so we
  // don't clobber a fresh `lastCheckedAt` / `latestVersion` that the detached
  // child may have written between the parent's setupUpdateCheck snapshot
  // capture and this notify call.
  const current = readSnapshot(args.cachePath, args.snapshot.currentVersion);
  const next: UpdateCheckSnapshot = {
    schemaVersion: 1,
    // Prefer the freshly-read fields (child may have refreshed them) but fall
    // back to the original snapshot if the file disappeared between calls.
    lastCheckedAt: current.lastCheckedAt ?? args.snapshot.lastCheckedAt,
    latestVersion: current.latestVersion ?? args.snapshot.latestVersion,
    lastNotifiedVersion: args.notifiedVersion,
    lastNotifiedAt: new Date(nowMs).toISOString(),
    currentVersion: current.currentVersion,
  };
  try {
    writeSnapshot(args.cachePath, next);
  } catch {
    // Silent failure — at worst, banner shows again next run.
  }
}

/**
 * Build a SuppressionContext from process state. Pure read — no side effects.
 *
 * @param argv The full argv (including subcommand and flags) used to detect
 *             machine-readable output flags. Pass [] for early-gate checks
 *             before argv parsing.
 * @param configEnabled Whether `defaults.update_check` is true (default).
 */
export function buildSuppressionContext(
  argv: string[],
  configEnabled: boolean,
  env: Record<string, string | undefined> = process.env,
): SuppressionContext {
  const optOutRaw = env.PHONE_A_FRIEND_UPDATE_CHECK;
  const envOptedOut =
    optOutRaw !== undefined &&
    (optOutRaw === 'false' || optOutRaw === '0' || optOutRaw.toLowerCase() === 'no');

  return {
    isStdoutTty: Boolean(process.stdout.isTTY),
    isStderrTty: Boolean(process.stderr.isTTY),
    isCi: Boolean(env.CI),
    isDumbTerm: env.TERM === 'dumb',
    hasMachineFlag: detectMachineFlag(argv),
    configEnabled,
    envOptedOut,
  };
}

function detectMachineFlag(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') return true;
    if (arg === '--json' || arg.startsWith('--json=')) return true;
    if (arg === '--schema' || arg.startsWith('--schema=')) return true;
    if (arg === '--verdict-json') return true;
  }
  // Machine-readable subcommands that print structured output to stdout by
  // default. Combined-stream pipes (e.g. `phone-a-friend config show 2>&1 | jq`)
  // can still pick up the banner without these gates even though it lives on
  // stderr, so we treat them as machine-mode.
  // Subcommand path: argv[0] is the subcommand name when invoked via Commander
  // (relay/setup/doctor/config/agentic/job/session/plugin/install/...).
  const sub = argv[0] ?? '';
  if (sub === '__update-check') return true;
  if (sub === 'doctor' && argv.includes('--json')) return true;
  if (sub === 'config' && argv[1] === 'show') return true;
  return false;
}

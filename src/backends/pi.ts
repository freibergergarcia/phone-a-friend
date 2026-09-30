/**
 * pi backend implementation (`@earendil-works/pi-coding-agent`).
 *
 * Subprocess backend using `pi --mode json`, which streams JSONL events and
 * exits when the prompt is done. pi has no sandbox and no `--dir` flag:
 *
 * - The PaF sandbox maps to pi's `--tools` allowlist. `read-only` means the
 *   model has no write or shell tool in that invocation; it is not OS
 *   isolation, and pi still runs with the user's permissions.
 * - `-ne` and `--no-approve` are always passed. Extensions run inside pi and
 *   can re-enable any built-in tool, so without them the allowlist would not
 *   be authoritative.
 * - The working directory selects the project, so every spawn uses the repo
 *   as cwd.
 * - pi saves every run unless told otherwise. A plain relay passes
 *   `--no-session`; a PaF session uses PaF's own session directory, and a
 *   resume is checked against that directory before anything is spawned,
 *   because `--session-id` silently creates a session that is missing.
 */

import { closeSync, mkdirSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter as pathDelimiter, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import {
  type Backend,
  type BackendCapabilities,
  type BackendRunOptions,
  BackendError,
  INSTALL_HINTS,
  registerBackend,
  spawnCli,
  SpawnCliError,
  SpawnCliTimeoutError,
  type SandboxMode,
} from './index.js';
import { loadConfig, pafConfigDir } from '../config.js';
import { probeVersion, resolveExecutableCandidates } from '../diagnostics.js';
import { injectSchemaPrompt } from './schema-prompt.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PiBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'PiBackendError';
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * Tool allowlist per sandbox. `workspace-write` has no `bash`: a shell can
 * write anywhere, which would erase the difference from full access.
 */
const PI_TOOLS: Record<SandboxMode, string> = {
  'read-only': 'read,grep,find,ls',
  'workspace-write': 'read,grep,find,ls,edit,write',
  'danger-full-access': 'read,grep,find,ls,edit,write,bash',
};

/** pi's own session ID rule (`assertValidSessionId` in its session manager). */
const PI_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function isValidPiSessionId(id: string): boolean {
  return PI_SESSION_ID_PATTERN.test(id);
}

export interface PiArgsOptions {
  prompt: string;
  sandbox: SandboxMode;
  model: string | null;
  /** From `[backends.pi] provider`. Passed separately from the model, whose ID may contain "/". */
  provider: string | null;
  /** `--fast`: skip context files and skills. */
  fast: boolean;
  /**
   * A PaF-owned session (directory plus exact ID), or `null` for an
   * ephemeral run. One field, so a call can never carry both `--no-session`
   * and `--session-id`.
   */
  session: { dir: string; id: string } | null;
}

/**
 * Build the pi argument vector. Pure and exported so the security-relevant
 * flags (`--tools`, `-ne`, `--no-approve`, session storage) are unit-testable
 * without spawning a subprocess.
 */
export function buildPiArgs(opts: PiArgsOptions): string[] {
  const args = ['--mode', 'json', '--no-approve'];

  if (opts.session) {
    if (!isValidPiSessionId(opts.session.id)) {
      throw new PiBackendError(
        `Invalid pi session ID "${opts.session.id}". pi session IDs use letters, digits, ".", "_" and "-", ` +
          'and start and end with a letter or digit.',
      );
    }
    args.push('--session-dir', opts.session.dir, '--session-id', opts.session.id);
  } else {
    // pi saves every run unless told otherwise.
    args.push('--no-session');
  }

  args.push('-ne', '-np', '--no-themes', '--tools', PI_TOOLS[opts.sandbox]);

  if (opts.provider) args.push('--provider', opts.provider);
  if (opts.model) args.push('--model', opts.model);
  if (opts.fast) args.push('-nc', '-ns');

  // `--` keeps a prompt that begins with "-" from being parsed as a flag. It
  // does not stop `@file` handling: pi reads a positional argument starting
  // with "@" as a file include even after `--`, so such a prompt gets a
  // leading newline and stays a message.
  args.push('--', opts.prompt.startsWith('@') ? `\n${opts.prompt}` : opts.prompt);
  return args;
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/** The `session` record pi writes first in JSON mode and as line one of a session file. */
export interface PiSessionHeader {
  id: string;
  cwd: string | null;
  timestamp: string | null;
}

export interface PiTranscript {
  header: PiSessionHeader | null;
  /** The `message` of the last assistant `message_end`, or null when there is none. */
  finalAssistant: Record<string, unknown> | null;
}

export interface PiParsedRun {
  text: string;
  header: PiSessionHeader | null;
}

const LOCAL_SERVER_HINT =
  "If the model runs locally, check the server is up (your provider's baseUrl).";

/** A stopped local server ends as "Connection error." after pi's retries, not as a timeout. */
function describePiFailure(detail: string): string {
  const looksLikeConnection = /connection error|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|socket hang up/i;
  return looksLikeConnection.test(detail) ? `${detail} ${LOCAL_SERVER_HINT}` : detail;
}

function stderrTail(stderr: string | undefined): string {
  if (!stderr) return '';
  const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.slice(-5).join(' | ').slice(-500);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read a `pi --mode json` stream without judging it. Records are split on LF
 * only (pi's framing rule: U+2028/U+2029 are legal inside strings), one
 * trailing CR is dropped, and anything that is not a JSON object is skipped.
 * Never throws.
 */
export function readPiJsonl(stdout: string): PiTranscript {
  let header: PiSessionHeader | null = null;
  let finalAssistant: Record<string, unknown> | null = null;

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) continue;
    let record: Record<string, unknown> | null;
    try {
      record = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (!record) continue;

    if (record.type === 'session' && !header && typeof record.id === 'string') {
      header = {
        id: record.id,
        cwd: typeof record.cwd === 'string' ? record.cwd : null,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : null,
      };
      continue;
    }

    if (record.type === 'message_end') {
      const message = asRecord(record.message);
      // `agent_end` with willRetry is not terminal, and earlier assistant
      // messages may be tool calls or retried errors: only the last counts.
      if (message?.role === 'assistant') finalAssistant = message;
    }
  }

  return { header, finalAssistant };
}

/** The error a finished stream reports, if its final assistant message is a failure. */
function piFailureDetail(finalAssistant: Record<string, unknown> | null): string | null {
  if (!finalAssistant) return null;
  const stopReason = finalAssistant.stopReason;
  if (stopReason !== 'error' && stopReason !== 'aborted') return null;
  const errorMessage = typeof finalAssistant.errorMessage === 'string' ? finalAssistant.errorMessage.trim() : '';
  return errorMessage || `request ${stopReason}`;
}

/**
 * Turn a finished `pi --mode json` stream into the final answer, failing
 * closed. JSON mode exits 0 even when the response failed, so the verdict
 * comes from the last assistant `message_end`:
 *
 * - `stopReason` `error` or `aborted` throws with `errorMessage`;
 * - only `stop` and `length` are an answer; any other stop reason throws;
 * - the text blocks are joined and trimmed, and empty text throws.
 *
 * It never falls back to an earlier assistant message.
 */
export function parsePiJsonl(stdout: string, ctx: { stderr?: string } = {}): PiParsedRun {
  const { header, finalAssistant } = readPiJsonl(stdout);

  if (!finalAssistant) {
    const tail = stderrTail(ctx.stderr);
    throw new PiBackendError(`pi produced no assistant message.${tail ? ` stderr: ${tail}` : ''}`);
  }

  const failure = piFailureDetail(finalAssistant);
  if (failure) {
    throw new PiBackendError(`pi reported an error: ${describePiFailure(failure)}`);
  }

  const stopReason = finalAssistant.stopReason;
  if (stopReason !== 'stop' && stopReason !== 'length') {
    const shown = typeof stopReason === 'string' ? `"${stopReason}"` : 'no stop reason';
    throw new PiBackendError(`pi ended with ${shown} instead of a final answer.`);
  }

  if (!Array.isArray(finalAssistant.content)) {
    throw new PiBackendError("pi's final message has an unexpected shape (content is not a list).");
  }

  const text = finalAssistant.content
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, unknown> => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();

  if (!text) {
    throw new PiBackendError('pi produced no text output.');
  }

  return { text, header };
}

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/** `--no-approve` arrived in 0.79.0; `--session-id` (0.76.0) and the `--tools` allowlist (0.68.0) are older. */
export const PI_MIN_VERSION = '0.79.0';

const PI_VERSION_PROBE_TIMEOUT_MS = 5000;

export type PiVersionProbe =
  | { status: 'missing' }
  | { status: 'unreadable'; path: string; reason: string }
  | { status: 'ok'; path: string; version: string };

/** Cache of `pi --version` probes, keyed by resolved executable plus PATH. */
const versionCache = new Map<string, Promise<PiVersionProbe>>();

/** Clear the version cache — only for testing. */
export function _resetPiVersionCache(): void {
  versionCache.clear();
}

export function isSupportedPiVersion(version: string): boolean {
  const parse = (text: string): number[] | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const actual = parse(version);
  const minimum = parse(PI_MIN_VERSION) as number[];
  if (!actual) return false;
  for (let i = 0; i < 3; i++) {
    if (actual[i] > minimum[i]) return true;
    if (actual[i] < minimum[i]) return false;
  }
  return true;
}

/**
 * Read the version of the `pi` on PATH.
 *
 * Runs `pi --version` at most once per resolved executable per process;
 * concurrent callers share the in-flight probe. Never throws: a missing
 * binary, a timeout, or an unparseable banner each have their own status and
 * the caller refuses to run on anything but `ok`.
 */
export function detectPiVersion(
  env: Record<string, string>,
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<PiVersionProbe> {
  // pi is spawned by bare name with cwd = the repo, and execvp resolves
  // relative PATH entries against that cwd. Resolve the same way here so the
  // probed binary is the one the child will run.
  const spawnCwd = opts.cwd ?? process.cwd();
  const absolutePath = (env.PATH ?? '')
    .split(pathDelimiter)
    .map((dir) => resolvePath(spawnCwd, dir || '.'))
    .join(pathDelimiter);
  const candidate = resolveExecutableCandidates('pi', { ...env, PATH: absolutePath })[0];
  if (!candidate) return Promise.resolve({ status: 'missing' });

  const key = `${candidate.resolvedPath}\0${absolutePath}`;
  const cached = versionCache.get(key);
  if (cached) return cached;

  const probe = probeVersion(candidate.path, {
    env,
    timeoutMs: opts.timeoutMs ?? PI_VERSION_PROBE_TIMEOUT_MS,
  })
    .then((result): PiVersionProbe => (result.version
      ? { status: 'ok', path: candidate.path, version: result.version }
      : { status: 'unreadable', path: candidate.path, reason: result.versionError ?? result.versionStatus }))
    .catch((): PiVersionProbe => ({ status: 'unreadable', path: candidate.path, reason: 'probe failed' }));
  versionCache.set(key, probe);
  return probe;
}

/** Refuse to run unless the installed pi is known to be new enough. No model spawn happens before this. */
async function assertSupportedPi(env: Record<string, string>, cwd: string): Promise<void> {
  const probe = await detectPiVersion(env, { cwd });
  if (probe.status === 'missing') {
    throw new PiBackendError(`pi CLI not found in PATH. Install it: ${INSTALL_HINTS.pi}`);
  }
  if (probe.status === 'unreadable') {
    throw new PiBackendError(
      `Could not read the pi version from \`${probe.path} --version\` (${probe.reason}). ` +
        `phone-a-friend needs pi ${PI_MIN_VERSION} or newer and will not run an unknown version. ` +
        `Run \`pi --version\` at the terminal, or reinstall: ${INSTALL_HINTS.pi}`,
    );
  }
  if (!isSupportedPiVersion(probe.version)) {
    throw new PiBackendError(
      `pi ${probe.version} is too old: phone-a-friend needs pi ${PI_MIN_VERSION} or newer ` +
        `(it relies on --no-approve). Upgrade with \`pi update\` or: ${INSTALL_HINTS.pi}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Recursion guard
// ---------------------------------------------------------------------------

/**
 * pi sets `PI_CODING_AGENT=true` in every child process it launches, so a
 * PaF call made from inside pi is detected without an install shim.
 * `PHONE_A_FRIEND_HOST=pi` is the explicit marker for programmatic callers.
 */
export function isPiHostEnv(env: Record<string, string | undefined>): boolean {
  return env.PI_CODING_AGENT === 'true' || env.PHONE_A_FRIEND_HOST?.toLowerCase() === 'pi';
}

function assertNotPiHost(env: Record<string, string>): void {
  if (!isPiHostEnv(env)) return;
  throw new PiBackendError(
    'pi is already the host for this Phone-a-Friend invocation. ' +
      'Choose another friend backend such as antigravity, codex, gemini, claude, or ollama.',
  );
}

// ---------------------------------------------------------------------------
// Config and paths
// ---------------------------------------------------------------------------

/**
 * `[backends.pi] provider`, read with the repo's `.phone-a-friend.toml`
 * merged over the user config. `ResolvedConfig` carries no backend-specific
 * keys, so the backend reads it; the generic `model` arrives through the
 * relay options.
 */
function readPiProvider(repoPath: string): string | null {
  let raw: unknown;
  try {
    raw = loadConfig(repoPath).backends?.pi?.provider;
  } catch (err) {
    throw new PiBackendError(
      `Could not read phone-a-friend config for ${repoPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PiBackendError(
      'Invalid [backends.pi] provider in phone-a-friend config: expected a non-empty string such as "mlx".',
    );
  }
  return raw.trim();
}

/**
 * The one repo path used for the spawn cwd. pi records the working directory
 * the OS reports, which has symlinks resolved (`/private/tmp/...` for
 * `/tmp/...` on macOS), while the relay resolves `--repo` lexically.
 */
function canonicalRepoPath(repoPath: string): string {
  try {
    return realpathSync(resolvePath(repoPath));
  } catch (err) {
    throw new PiBackendError(
      `Repository path cannot be resolved: ${repoPath} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Where PaF keeps pi sessions. Passing it as `--session-dir` overrides
 * `PI_CODING_AGENT_SESSION_DIR` and the user and project `sessionDir`
 * settings, and keeps PaF's sessions out of the user's `pi --resume` picker.
 */
export function piSessionDir(): string {
  return join(pafConfigDir(), 'pi-sessions');
}

/** pi's bound on header discovery (`MAX_SESSION_HEADER_SCAN_BYTES`). */
const PI_HEADER_SCAN_LIMIT_BYTES = 1024 * 1024;
const PI_HEADER_READ_BUFFER_BYTES = 4096;

/**
 * Judge one physical line the way pi's `parseSessionHeaderCandidate` does:
 * `undefined` to keep scanning (blank, malformed, or a falsy JSON value),
 * `null` when the first parsed entry is not a session header, else the header.
 */
function piHeaderCandidate(line: string): Record<string, unknown> | null | undefined {
  if (!line.trim()) return undefined;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!entry) return undefined;
  const record = entry as Record<string, unknown>;
  if (record.type !== 'session' || typeof record.id !== 'string') return null;
  return record;
}

/**
 * Find a session file's header exactly as pi 0.87.1 does (`readSessionHeader`
 * in its session manager): scan physical lines, skipping blank and malformed
 * ones, inside a 1 MiB bound. Reading only the first line would disagree
 * with pi on a file whose header follows junk. Throws on a read error or
 * when the bound is exceeded; pi treats both as "not a session".
 */
function readPiSessionFileHeader(filePath: string): Record<string, unknown> | null {
  const fd = openSync(filePath, 'r');
  try {
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.allocUnsafe(PI_HEADER_READ_BUFFER_BYTES);
    let pending = '';
    let scannedBytes = 0;
    while (scannedBytes < PI_HEADER_SCAN_LIMIT_BYTES) {
      const readLength = Math.min(buffer.length, PI_HEADER_SCAN_LIMIT_BYTES - scannedBytes);
      const bytesRead = readSync(fd, buffer, 0, readLength, null);
      if (bytesRead === 0) {
        return piHeaderCandidate(pending + decoder.end()) ?? null;
      }
      scannedBytes += bytesRead;
      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = chunk.indexOf('\n', lineStart);
      while (newlineIndex !== -1) {
        const decision = piHeaderCandidate(pending + chunk.slice(lineStart, newlineIndex));
        if (decision !== undefined) return decision;
        pending = '';
        lineStart = newlineIndex + 1;
        newlineIndex = chunk.indexOf('\n', lineStart);
      }
      pending += chunk.slice(lineStart);
    }
    // A final header without a newline may end exactly at the bound.
    const probe = Buffer.allocUnsafe(1);
    if (readSync(fd, probe, 0, probe.length, null) === 0) {
      return piHeaderCandidate(pending + decoder.end()) ?? null;
    }
    throw new Error('session header exceeds the scan bound');
  } finally {
    closeSync(fd);
  }
}

/**
 * pi's `resolvePath` for a stored cwd on POSIX: `~` expansion, `file://` URLs,
 * then lexical resolution against pi's working directory, which is the repo.
 * (pi also rewrites Windows shell paths; PaF does not mirror that.) Throws
 * where pi would, e.g. a `file://` URL with a host.
 */
function resolvePiStoredPath(stored: string, baseDir: string): string {
  let normalized = stored;
  if (normalized === '~') {
    normalized = homedir();
  } else if (normalized.startsWith('~/')) {
    normalized = join(homedir(), normalized.slice(2));
  } else if (/^file:\/\//.test(normalized)) {
    normalized = fileURLToPath(normalized);
  }
  return isAbsolute(normalized) ? resolvePath(normalized) : resolvePath(baseDir, normalized);
}

function toHeader(record: Record<string, unknown>): PiSessionHeader {
  return {
    id: record.id as string,
    cwd: typeof record.cwd === 'string' ? record.cwd : null,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : null,
  };
}

/**
 * Every session file pi could open for `--session-id <id>` from `repoCwd`
 * with PaF's session directory: the same scan as `SessionManager.findById`
 * (each `*.jsonl`, header `id` equal, header `cwd` resolving to the working
 * directory). pi takes the first match in directory order; the caller
 * requires exactly one. A missing or unreadable directory yields none.
 */
function findPiSessionFiles(dir: string, id: string, repoCwd: string): PiSessionHeader[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const matches: PiSessionHeader[] = [];
  for (const file of entries) {
    if (!file.endsWith('.jsonl')) continue;
    const filePath = join(dir, file);
    let record: Record<string, unknown> | null;
    try {
      record = readPiSessionFileHeader(filePath);
    } catch {
      // Unreadable or oversized: not a session, for pi and for PaF.
      continue;
    }
    if (!record || record.id !== id) continue;
    const cwd = record.cwd;
    if (typeof cwd !== 'string' || cwd === '') continue;
    let resolved: string;
    try {
      resolved = resolvePiStoredPath(cwd, repoCwd);
    } catch {
      // pi's scan aborts on this error and then creates a new session.
      throw new PiBackendError(
        `pi session ${id} cannot be verified: the working directory recorded in ${filePath} cannot be resolved.`,
      );
    }
    if (resolved === repoCwd) matches.push(toHeader(record));
  }
  return matches;
}

interface PiSessionPlan {
  dir: string;
  id: string;
  /** The header read before spawning. Set on resume, null on start. */
  expected: PiSessionHeader | null;
}

/**
 * Decide the session flags for a call, failing before any spawn when a
 * resume cannot be proven to reach an existing session.
 */
function planPiSession(opts: BackendRunOptions, repoCwd: string): PiSessionPlan | null {
  const id = opts.sessionId;
  if (!id) return null;
  if (!isValidPiSessionId(id)) {
    throw new PiBackendError(
      `Invalid pi session ID "${id}". pi session IDs use letters, digits, ".", "_" and "-", ` +
        'and start and end with a letter or digit.',
    );
  }

  const dir = piSessionDir();
  const matches = findPiSessionFiles(dir, id, repoCwd);

  if (opts.resumeSession) {
    if (matches.length === 0) {
      throw new PiBackendError(
        `pi session ${id} not found for ${repoCwd}: it is not in phone-a-friend's pi session directory (${dir}). ` +
          'Sessions started directly in pi cannot be attached in this version.',
      );
    }
    if (matches.length > 1) {
      throw new PiBackendError(
        `pi session ${id} is ambiguous: ${matches.length} session files in ${dir} carry that ID for ${repoCwd}. ` +
          'Refusing to resume, because pi would pick one of them by directory order.',
      );
    }
    return { dir, id, expected: matches[0] };
  }

  if (matches.length > 0) {
    // `--session-id` would open that session instead of starting a new one.
    throw new PiBackendError(
      `pi session ${id} already exists for ${repoCwd} in ${dir}; refusing to start a new session under that ID.`,
    );
  }
  mkdirSync(dir, { recursive: true });
  return { dir, id, expected: null };
}

/**
 * After a run, confirm pi used the session PaF asked for. Throwing here is
 * what keeps a wrong mapping out of PaF's session store: the relay persists
 * the ID it generated after any `run()` that resolves.
 *
 * On resume the emitted header must equal the one read before spawning. A
 * resumed session re-emits its original header, while a session pi created
 * in the meantime has a new timestamp. This is detection, not prevention.
 */
function confirmPiSession(
  plan: PiSessionPlan,
  header: PiSessionHeader | null,
  stderr: string,
  repoCwd: string,
): void {
  if (!header) {
    throw new PiBackendError(`pi reported no session header, so session ${plan.id} cannot be confirmed.`);
  }

  if (plan.expected) {
    const createdInstead = /No project session found with id|creating a new session/i.test(stderr);
    const sameHeader =
      header.id === plan.expected.id &&
      header.cwd === plan.expected.cwd &&
      header.timestamp === plan.expected.timestamp;
    if (createdInstead || !sameHeader) {
      throw new PiBackendError(
        `pi did not resume session ${plan.id}: it reported session ${header.id} (started ${header.timestamp ?? 'unknown'}, ` +
          `cwd ${header.cwd ?? 'unknown'}) instead of the one phone-a-friend checked. The reply was discarded.`,
      );
    }
    return;
  }

  let reportedCwd: string | null = null;
  try {
    reportedCwd = header.cwd ? resolvePiStoredPath(header.cwd, repoCwd) : null;
  } catch {
    reportedCwd = null;
  }
  if (header.id !== plan.id || reportedCwd !== repoCwd) {
    throw new PiBackendError(
      `pi reported session ${header.id} in ${header.cwd ?? 'an unknown directory'}, not the requested ` +
        `${plan.id} in ${repoCwd}. The session was not recorded.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

function timeoutMessage(timeoutSeconds: number): string {
  return (
    `pi timed out after ${timeoutSeconds}s. If the model runs locally, check the server is up ` +
    "(your provider's baseUrl) and try a smaller model."
  );
}

/** Translate a failed spawn into a PiBackendError, preferring what pi itself reported. */
function toPiError(err: unknown, timeoutSeconds: number): PiBackendError {
  if (err instanceof PiBackendError) return err;
  if (err instanceof SpawnCliTimeoutError) return new PiBackendError(timeoutMessage(timeoutSeconds));
  if (err instanceof SpawnCliError) {
    // An invocation error exits nonzero, sometimes after the stream already
    // carried a failed response; that message is the more useful one.
    const failure = piFailureDetail(readPiJsonl(err.stdout).finalAssistant);
    if (failure) return new PiBackendError(`pi reported an error: ${describePiFailure(failure)}`);
    const tail = stderrTail(err.stderr);
    return new PiBackendError(`pi exited with code ${err.exitCode ?? 'unknown'}${tail ? `: ${tail}` : '.'}`);
  }
  if (err instanceof BackendError) return new PiBackendError(err.message);
  return new PiBackendError(err instanceof Error ? err.message : String(err));
}

export class PiBackend implements Backend {
  readonly name = 'pi';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'native-session',
    // PaF picks the ID and passes it as `--session-id`, as for Claude and Gemini.
    requiresClientSessionId: true,
  };

  async run(opts: BackendRunOptions): Promise<string> {
    assertNotPiHost(opts.env);
    const repoCwd = canonicalRepoPath(opts.repoPath);
    const provider = readPiProvider(opts.repoPath);
    await assertSupportedPi(opts.env, repoCwd);
    // Last step before the spawn: a resume that cannot be proven fails here.
    const session = planPiSession(opts, repoCwd);

    // pi has no structured-output flag: ask for JSON in the prompt and let
    // the caller parse it (best-effort, as for Gemini and OpenCode).
    const prompt = opts.schema ? injectSchemaPrompt(opts.prompt, opts.schema) : opts.prompt;
    const args = buildPiArgs({
      prompt,
      sandbox: opts.sandbox,
      model: opts.model,
      provider,
      fast: Boolean(opts.fast),
      session: session ? { dir: session.dir, id: session.id } : null,
    });

    try {
      const result = await spawnCli('pi', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: repoCwd,
        label: 'pi',
      });
      const parsed = parsePiJsonl(result.stdout, { stderr: result.stderr });
      if (session) {
        confirmPiSession(session, parsed.header, result.stderr, repoCwd);
        opts.onSessionCreated?.(session.id);
      }
      return parsed.text;
    } catch (err: unknown) {
      throw toPiError(err, opts.timeoutSeconds);
    }
  }
}

export const PI_BACKEND = new PiBackend();
registerBackend(PI_BACKEND);

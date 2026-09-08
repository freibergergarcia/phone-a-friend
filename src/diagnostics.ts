/**
 * Executable diagnostics for `phone-a-friend doctor`.
 *
 * Every CLI backend is spawned by bare command name (`spawnCli('codex', …)`)
 * and inherits the parent PATH, so the executable PaF actually runs is the
 * first PATH entry that holds an executable file with that name. Interactive
 * shell aliases and functions never participate in that lookup. This module
 * makes that resolution visible: it lists every PATH candidate, probes each
 * one's `--version` with a bounded timeout, and explains ambiguity honestly.
 *
 * Boundaries:
 * - Argv-based `execFile` only; no shell, no interpolation.
 * - Never runs a model request. `--version` is the only subprocess call.
 * - Scans PATH only; never the whole disk.
 * - Read-only. Never mutates PATH, config, or installations.
 * - Kept separate from `detection.ts` so `detectAll()` stays cheap for the TUI.
 */

import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, realpathSync, statSync, readFileSync } from 'node:fs';
import { delimiter as pathDelimiter, dirname, join, resolve as resolvePath } from 'node:path';
import { BACKEND_COMMANDS, getBackend } from './backends/index.js';
import type { DetectionReport, BackendStatus } from './detection.js';
import type { PafConfig } from './config.js';
import { getPackageRoot, getVersion } from './version.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VersionProbeStatus =
  /** A version string was parsed from the probe output. */
  | 'ok'
  /** The probe exceeded its timeout and was killed. */
  | 'timeout'
  /** The executable could not be run (permission denied). */
  | 'permission-denied'
  /** The probe ran but exited non-zero or failed to start. */
  | 'failed'
  /** The probe ran but produced no recognizable version string. */
  | 'unparsed'
  /** The probe was skipped (candidate cap reached). */
  | 'not-probed';

export interface ExecutableCandidate {
  /** Path as found on PATH (before symlink resolution). */
  path: string;
  /** Symlink-resolved path; equals `path` when not a symlink. */
  resolvedPath: string;
  /** Parsed semver-like version, or null when unavailable. */
  version: string | null;
  versionStatus: VersionProbeStatus;
  /** Short, allowlisted reason when `versionStatus` is not `ok`. */
  versionError?: string;
}

export interface ExecutableInfo {
  /** Bare command name PaF passes to spawn (e.g. `codex`, `agy`). */
  command: string;
  /**
   * The candidate a PaF subprocess resolves to: the first PATH match.
   * Null when the command is not on PATH.
   */
  selected: ExecutableCandidate | null;
  /** All unique candidates in PATH order (deduplicated by resolved path). */
  candidates: ExecutableCandidate[];
  /** More than one distinct executable is reachable through PATH. */
  shadowed: boolean;
  /** Probed candidates report more than one distinct version. */
  versionMismatch: boolean;
  /** Actionable, machine-agnostic guidance derived from the observations. */
  guidance: string[];
}

export interface ModelDiagnostics {
  /** Model PaF will request, from its own config; null means backend default. */
  requested: string | null;
  requestedSource: 'paf-config' | 'backend-default';
  /**
   * Model the backend actually used. Doctor never runs a backend, so this is
   * always null here; it is only knowable from a real run's output.
   */
  reported: null;
  reportedNote: string;
}

export interface CapabilityDiagnostics {
  /** Capabilities the backend adapter declares in source. Not runtime-verified. */
  declared: {
    resumeStrategy: string;
    requiresClientSessionId: boolean;
    localFileAccess: boolean;
  };
  verification: 'declared-only';
  verificationNote: string;
}

export interface PafIdentity {
  /** Version of the PaF build executing this doctor run. */
  version: string;
  /** Package root of the running build. */
  packageRoot: string;
  /** Entry script of the running process, symlink-resolved when possible. */
  entry: string | null;
  /** `phone-a-friend` installs reachable through PATH, with their versions. */
  pathCandidates: ExecutableCandidate[];
  /** The PATH-selected install is a different build from the one running. */
  runningDiffersFromPath: boolean;
  guidance: string[];
}

export interface DiagnosticsDeps {
  env: NodeJS.ProcessEnv;
  execFileFn: typeof execFile;
  timeoutMs: number;
  maxProbes: number;
  argv1: string | undefined;
}

// ---------------------------------------------------------------------------
// Defaults and constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_PROBES = 6;
const VERSION_RE = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?![\d.])/;

const SHELL_NOTE =
  'Interactive shell aliases and functions do not affect PaF subprocesses; only PATH order does.';

function defaultDeps(overrides?: Partial<DiagnosticsDeps>): DiagnosticsDeps {
  return {
    env: process.env,
    execFileFn: execFile,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxProbes: DEFAULT_MAX_PROBES,
    argv1: process.argv[1],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PATH resolution
// ---------------------------------------------------------------------------

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Enumerate every executable named `command` reachable through PATH, in
 * lookup order, deduplicated by symlink target. Mirrors execvp semantics
 * (first match wins) without invoking a shell.
 */
export function resolveExecutableCandidates(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Omit<ExecutableCandidate, 'version' | 'versionStatus'>[] {
  // Node's Unix subprocess lookup uses these defaults when PATH is absent.
  // An explicitly empty component (including PATH='') means the current directory.
  const pathValue = env.PATH ?? '/usr/bin:/bin';

  const seen = new Set<string>();
  const out: Omit<ExecutableCandidate, 'version' | 'versionStatus'>[] = [];
  for (const dir of pathValue.split(pathDelimiter)) {
    const candidate = resolvePath(dir || '.', command);
    if (!isExecutableFile(candidate)) continue;
    const resolved = safeRealpath(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ path: candidate, resolvedPath: resolved });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Version probing
// ---------------------------------------------------------------------------

export function parseVersionOutput(stdout: string, stderr: string): string | null {
  for (const text of [stdout, stderr]) {
    const match = VERSION_RE.exec(text);
    if (match) return match[1];
  }
  return null;
}

interface ExecFileError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

/**
 * Run `<path> --version` with a hard timeout and classify the outcome.
 * Never throws; every failure mode maps to a status the caller can render.
 */
export function probeVersion(
  path: string,
  deps: Partial<DiagnosticsDeps> = {},
): Promise<Pick<ExecutableCandidate, 'version' | 'versionStatus' | 'versionError'>> {
  const { execFileFn, timeoutMs, env } = defaultDeps(deps);
  return new Promise((resolve) => {
    execFileFn(
      path,
      ['--version'],
      {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : String(stdout ?? '');
        const errOut = typeof stderr === 'string' ? stderr : String(stderr ?? '');
        if (err) {
          const e = err as ExecFileError;
          if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            resolve({ version: null, versionStatus: 'failed', versionError: '--version output exceeded the size limit' });
            return;
          }
          if (e.killed || e.signal === 'SIGKILL') {
            resolve({
              version: null,
              versionStatus: 'timeout',
              versionError: `--version did not finish within ${timeoutMs / 1000}s`,
            });
            return;
          }
          if (e.code === 'EACCES' || e.code === 'EPERM') {
            resolve({ version: null, versionStatus: 'permission-denied', versionError: 'permission denied' });
            return;
          }
          if (typeof e.code === 'string') {
            resolve({ version: null, versionStatus: 'failed', versionError: e.code === 'ENOENT' ? 'executable not found (ENOENT)' : 'failed to start' });
            return;
          }
          // Non-zero exit. Some CLIs still print a version before failing;
          // only trust it when it parses cleanly.
          const parsed = parseVersionOutput(out, errOut);
          if (parsed) {
            resolve({ version: parsed, versionStatus: 'ok' });
            return;
          }
          const detail = typeof e.code === 'number' ? `exit code ${e.code}` : '--version failed';
          resolve({ version: null, versionStatus: 'failed', versionError: detail });
          return;
        }
        const parsed = parseVersionOutput(out, errOut);
        if (parsed) {
          resolve({ version: parsed, versionStatus: 'ok' });
          return;
        }
        resolve({
          version: null,
          versionStatus: 'unparsed',
          versionError: (out || errOut).trim() ? 'unrecognized version output' : 'no output',
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Per-command inspection
// ---------------------------------------------------------------------------

function buildExecutableGuidance(info: Omit<ExecutableInfo, 'guidance'>): string[] {
  const guidance: string[] = [];
  const { command, selected, candidates } = info;

  if (!selected) {
    return guidance;
  }

  const describe = (c: ExecutableCandidate): string => {
    const version = c.version ?? `version ${c.versionStatus}`;
    return `${c.path} (${version})`;
  };

  if (candidates.length > 1) {
    const others = candidates.filter(c => c !== selected).map(describe).join(', ');
    guidance.push(
      `The first PATH match for "${command}" is ${describe(selected)}. Also on PATH: ${others}.`,
    );
    if (info.versionMismatch) {
      guidance.push(
        `These installs report different versions. If a relay fails on a model or flag that a newer ${command} supports, ` +
          'put that install\'s directory earlier in PATH for the PaF process, or remove the duplicates. ' +
          'A newer version does not by itself guarantee support for a given model.',
      );
    } else if (candidates.every(c => c.versionStatus === 'ok')) {
      guidance.push('All probed candidates report the same version; no action needed unless one is stale.');
    }
    guidance.push(SHELL_NOTE);
  }

  for (const c of candidates) {
    if (c.versionStatus === 'ok' || c.versionStatus === 'not-probed') continue;
    guidance.push(
      `Could not determine the version of ${c.path}: ${c.versionError ?? c.versionStatus}. ` +
        `Run "${c.path} --version" manually to inspect it.`,
    );
  }

  const skipped = candidates.filter(c => c.versionStatus === 'not-probed').length;
  if (skipped > 0) {
    guidance.push(`${skipped} additional PATH candidate(s) were not probed (probe cap reached).`);
  }

  return guidance;
}

/**
 * Resolve and probe every PATH candidate for one command.
 */
export async function inspectExecutable(
  command: string,
  deps: Partial<DiagnosticsDeps> = {},
): Promise<ExecutableInfo> {
  const d = defaultDeps(deps);
  const found = resolveExecutableCandidates(command, d.env);

  const candidates: ExecutableCandidate[] = await Promise.all(
    found.map(async (c, index): Promise<ExecutableCandidate> => {
      if (index >= d.maxProbes) {
        return { ...c, version: null, versionStatus: 'not-probed' };
      }
      const probe = await probeVersion(c.path, d);
      return { ...c, ...probe };
    }),
  );

  const selected = candidates[0] ?? null;
  const versions = new Set(candidates.filter(c => c.version).map(c => c.version as string));
  const partial: Omit<ExecutableInfo, 'guidance'> = {
    command,
    selected,
    candidates,
    shadowed: candidates.length > 1,
    versionMismatch: versions.size > 1,
  };
  return { ...partial, guidance: buildExecutableGuidance(partial) };
}

// ---------------------------------------------------------------------------
// Report decoration
// ---------------------------------------------------------------------------

function commandFor(backend: BackendStatus): string {
  return BACKEND_COMMANDS[backend.name] ?? backend.name;
}

/**
 * Attach executable diagnostics to every backend entry that is spawned as a
 * CLI (CLI, local Ollama binary, and host integrations, Claude included).
 * Commands shared across categories (opencode, codex, claude) are inspected once.
 */
export async function inspectExecutables(
  report: DetectionReport,
  deps: Partial<DiagnosticsDeps> = {},
): Promise<void> {
  const entries = [...report.cli, ...report.local, ...report.host].filter(b => !b.planned);
  const commands = [...new Set(entries.map(commandFor))];
  const results = await Promise.all(commands.map(cmd => inspectExecutable(cmd, deps)));
  const byCommand = new Map(commands.map((cmd, i) => [cmd, results[i]]));
  for (const b of entries) {
    const info = byCommand.get(commandFor(b));
    if (info) b.executable = info;
  }
}

/**
 * Attach requested-model and declared-capability facts from PaF's own config
 * and backend registry. No backend is run, so the reported model stays null.
 */
export function attachModelAndCapabilities(report: DetectionReport, config: PafConfig): void {
  const entries = [...report.cli, ...report.local, ...report.host].filter(b => !b.planned);
  for (const b of entries) {
    const configured =
      config.backends?.[b.name]?.model ??
      (config[b.name] as { model?: string } | undefined)?.model ??
      null;
    b.model = {
      requested: configured,
      requestedSource: configured ? 'paf-config' : 'backend-default',
      reported: null,
      reportedNote: 'Unknown: doctor does not run backends. Only a real relay reveals the model actually used.',
    };

    try {
      const backend = getBackend(b.name);
      b.capabilities = {
        declared: {
          resumeStrategy: backend.capabilities.resumeStrategy,
          requiresClientSessionId: backend.capabilities.requiresClientSessionId,
          localFileAccess: backend.localFileAccess,
        },
        verification: 'declared-only',
        verificationNote: 'Declared by the PaF adapter in source; not verified against the installed CLI.',
      };
    } catch {
      // Not a registered relay backend (registry may be empty in isolated contexts).
    }
  }
}

// ---------------------------------------------------------------------------
// PaF identity
// ---------------------------------------------------------------------------

function inspectPafPackage(entry: string): { root: string; version: string } | null {
  for (const root of [dirname(entry), dirname(dirname(entry))]) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (pkg.name !== '@freibergergarcia/phone-a-friend' || typeof pkg.version !== 'string') continue;
      const isBundle = entry === join(root, 'dist', 'index.js');
      const isCheckoutWrapper = entry === join(root, 'phone-a-friend') &&
        readFileSync(entry, 'utf8').includes('exec node "${SCRIPT_DIR}/dist/index.js" "$@"');
      if (isBundle || isCheckoutWrapper) return { root, version: pkg.version };
    } catch {
      // Unknown layout or unreadable package: do not guess another install's identity.
    }
  }
  return null;
}

/**
 * Describe the PaF build running now and every `phone-a-friend` install on
 * PATH. Recognizes dist/index.js and the shipped checkout wrapper, reading
 * package.json without subprocesses or an update-check network call.
 */
export function inspectPafIdentity(deps: Partial<DiagnosticsDeps> = {}): PafIdentity {
  const d = defaultDeps(deps);
  const packageRoot = getPackageRoot();
  const version = getVersion();
  const entry = d.argv1 ? safeRealpath(d.argv1) : null;

  const pathCandidates: ExecutableCandidate[] = resolveExecutableCandidates('phone-a-friend', d.env).map(c => {
    const pkg = inspectPafPackage(c.resolvedPath);
    return pkg
      ? { ...c, version: pkg.version, versionStatus: 'ok' as const }
      : { ...c, version: null, versionStatus: 'unparsed' as const, versionError: 'unrecognized PaF installation layout' };
  });

  const selected = pathCandidates[0];
  const runningRoot = safeRealpath(packageRoot);
  const selectedPackage = selected ? inspectPafPackage(selected.resolvedPath) : null;
  const selectedRoot = selectedPackage ? safeRealpath(selectedPackage.root) : null;
  const runningDiffersFromPath = selectedRoot !== null && selectedRoot !== runningRoot;

  const guidance: string[] = [];
  if (runningDiffersFromPath && selected) {
    guidance.push(
      `This doctor run is PaF ${version} at ${packageRoot}, but "phone-a-friend" on PATH resolves to ` +
        `${selected.path} (${selected.version ?? 'unknown version'}). Host skills and slash commands that call ` +
        '"phone-a-friend" use the PATH install, so their behavior may differ from this checkout.',
    );
  }
  if (pathCandidates.length > 1) {
    const list = pathCandidates.map(c => `${c.path} (${c.version ?? 'unknown version'})`).join(', ');
    guidance.push(`Multiple phone-a-friend installs are on PATH: ${list}. The first one wins for subprocess calls.`);
  }

  return { version, packageRoot, entry, pathCandidates, runningDiffersFromPath, guidance };
}

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
 */

import { realpathSync } from 'node:fs';
import { delimiter as pathDelimiter, resolve as resolvePath } from 'node:path';
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
import { loadConfig } from '../config.js';
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
    resumeStrategy: 'unsupported',
    requiresClientSessionId: false,
  };

  async run(opts: BackendRunOptions): Promise<string> {
    assertNotPiHost(opts.env);
    const repoCwd = canonicalRepoPath(opts.repoPath);
    const provider = readPiProvider(opts.repoPath);
    await assertSupportedPi(opts.env, repoCwd);

    // pi has no structured-output flag: ask for JSON in the prompt and let
    // the caller parse it (best-effort, as for Gemini and OpenCode).
    const prompt = opts.schema ? injectSchemaPrompt(opts.prompt, opts.schema) : opts.prompt;
    const args = buildPiArgs({
      prompt,
      sandbox: opts.sandbox,
      model: opts.model,
      provider,
      fast: Boolean(opts.fast),
      session: null,
    });

    try {
      const result = await spawnCli('pi', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: repoCwd,
        label: 'pi',
      });
      return parsePiJsonl(result.stdout, { stderr: result.stderr }).text;
    } catch (err: unknown) {
      throw toPiError(err, opts.timeoutSeconds);
    }
  }
}

export const PI_BACKEND = new PiBackend();
registerBackend(PI_BACKEND);

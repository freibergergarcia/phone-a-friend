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
 *   be authoritative. From pi 0.99 `-ne` also turns off pi's built-in
 *   extensions (MCP servers, codemode, tool search, the llama.cpp provider);
 *   providers defined in `models.json` are unaffected.
 * - The working directory selects the project, so every spawn uses the repo
 *   as cwd.
 * - pi saves every run unless told otherwise. A plain relay passes
 *   `--no-session`; a PaF session uses PaF's own session directory, and a
 *   resume is checked against that directory before anything is spawned,
 *   because `--session-id` silently creates a session that is missing.
 */

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter as pathDelimiter, join, posix, resolve as resolvePath, win32 } from 'node:path';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import {
  type Backend,
  type BackendCapabilities,
  type BackendEvent,
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

/** One physical line of a `pi --mode json` stream, or null when it is not a JSON object. */
function parsePiRecord(rawLine: string): Record<string, unknown> | null {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  if (!line.trim()) return null;
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

/** Fold one record into the transcript: the first session header and the last assistant `message_end`. */
function notePiRecord(transcript: PiTranscript, record: Record<string, unknown>): void {
  if (record.type === 'session' && !transcript.header && typeof record.id === 'string') {
    transcript.header = {
      id: record.id,
      cwd: typeof record.cwd === 'string' ? record.cwd : null,
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : null,
    };
    return;
  }

  if (record.type === 'message_end') {
    const message = asRecord(record.message);
    // `agent_end` with willRetry is not terminal, and earlier assistant
    // messages may be tool calls or retried errors: only the last counts.
    if (message?.role === 'assistant') transcript.finalAssistant = message;
  }
}

/**
 * Read a `pi --mode json` stream without judging it. Records are split on LF
 * only (pi's framing rule: U+2028/U+2029 are legal inside strings), one
 * trailing CR is dropped, and anything that is not a JSON object is skipped.
 * Never throws.
 */
export function readPiJsonl(stdout: string): PiTranscript {
  const transcript: PiTranscript = { header: null, finalAssistant: null };
  for (const rawLine of stdout.split('\n')) {
    const record = parsePiRecord(rawLine);
    if (record) notePiRecord(transcript, record);
  }
  return transcript;
}

/** The error a finished stream reports, if its final assistant message is a failure. */
function piFailureDetail(finalAssistant: Record<string, unknown> | null): string | null {
  if (!finalAssistant) return null;
  const stopReason = finalAssistant.stopReason;
  if (stopReason !== 'error' && stopReason !== 'aborted') return null;
  const errorMessage = typeof finalAssistant.errorMessage === 'string' ? finalAssistant.errorMessage.trim() : '';
  return errorMessage || `request ${stopReason}`;
}

/** The text blocks of an assistant message, joined in `content` order and not trimmed. */
function piMessageText(message: Record<string, unknown>): string {
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, unknown> => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

/**
 * The final answer of a finished run, failing closed. JSON mode exits 0 even
 * when the response failed, so the verdict comes from the last assistant
 * `message_end`:
 *
 * - `stopReason` `error` or `aborted` throws with `errorMessage`;
 * - only `stop` and `length` are an answer; any other stop reason throws;
 * - the text blocks are joined and trimmed, and empty text throws.
 *
 * It never falls back to an earlier assistant message.
 */
function piAnswer(transcript: PiTranscript, ctx: { stderr?: string } = {}): string {
  const { finalAssistant } = transcript;

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

  const text = piMessageText(finalAssistant).trim();
  if (!text) {
    // Small local models sometimes end on a reasoning block, for example a
    // tool call written as text inside it. The reasoning is never returned.
    const onlyReasoning = finalAssistant.content.some((block) => asRecord(block)?.type === 'thinking');
    throw new PiBackendError(
      onlyReasoning
        ? "pi produced no text output: the model's last message held only reasoning. " +
          'With a small local model, try --fast or a larger model.'
        : 'pi produced no text output.',
    );
  }
  return text;
}

/** Turn a finished `pi --mode json` stream into the final answer and session header. See `piAnswer`. */
export function parsePiJsonl(stdout: string, ctx: { stderr?: string } = {}): PiParsedRun {
  const transcript = readPiJsonl(stdout);
  return { text: piAnswer(transcript, ctx), header: transcript.header };
}

// ---------------------------------------------------------------------------
// Streaming and progress
// ---------------------------------------------------------------------------

/**
 * Cut text that arrives in arbitrary pieces into lines, on LF only. Node's
 * `readline` also splits on U+2028/U+2029, which are legal inside pi's JSON
 * strings, so it is not used.
 */
function createLineSplitter(onLine: (line: string) => void): { push(text: string): void; end(): void } {
  let pending = '';
  return {
    push(text) {
      let start = 0;
      let newline = text.indexOf('\n');
      while (newline !== -1) {
        onLine(pending + text.slice(start, newline));
        pending = '';
        start = newline + 1;
        newline = text.indexOf('\n', start);
      }
      pending += text.slice(start);
    },
    end() {
      if (pending) onLine(pending);
      pending = '';
    },
  };
}

/** The records of a live `pi --mode json` stdout, decoded as UTF-8 across chunk boundaries. */
async function* piRecords(stdout: Readable): AsyncGenerator<Record<string, unknown>> {
  const decoder = new StringDecoder('utf8');
  let ready: Array<Record<string, unknown>> = [];
  const splitter = createLineSplitter((line) => {
    const record = parsePiRecord(line);
    if (record) ready.push(record);
  });
  for await (const chunk of stdout) {
    splitter.push(typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer));
    if (ready.length > 0) {
      const batch = ready;
      ready = [];
      yield* batch;
    }
  }
  splitter.push(decoder.end());
  splitter.end();
  yield* ready;
}

const PI_PROGRESS_DETAIL_LIMIT = 160;

function shortDetail(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PI_PROGRESS_DETAIL_LIMIT ? `${flat.slice(0, PI_PROGRESS_DETAIL_LIMIT - 1)}…` : flat;
}

/**
 * The one or two arguments that say what a tool call is doing. Fail closed:
 * only named fields of pi's built-in tools are shown, never file contents
 * (`write.content`, `edit.oldText`/`newText`), and a tool PaF does not know
 * gets no detail at all.
 */
function summarizePiToolArgs(toolName: string, args: unknown): string {
  const record = asRecord(args);
  if (!record) return '';
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '');
  switch (toolName) {
    case 'bash':
      return shortDetail(text('command'));
    case 'read':
    case 'ls':
    case 'edit':
    case 'write':
      return shortDetail(text('path'));
    case 'grep':
    case 'find':
      return shortDetail([text('pattern'), text('path')].filter(Boolean).join(' '));
    default:
      return '';
  }
}

/** The reasons pi documents for `compaction_start` (json.md). Anything else is not echoed. */
const PI_COMPACTION_REASONS = new Set(['manual', 'threshold', 'overflow']);

/**
 * The progress a pi record reports, if any: a tool call starting, pi
 * retrying after a failed request (a stopped local server is otherwise
 * several seconds of silence), or pi compacting the context of a long
 * session. Text, thinking and turn records report nothing, and neither does
 * `compaction_end`, which carries the conversation summary.
 */
export function piEventsFromRecord(record: Record<string, unknown>): BackendEvent[] {
  if (record.type === 'tool_execution_start') {
    const toolName = typeof record.toolName === 'string' ? record.toolName.trim() : '';
    if (!toolName) return [];
    const detail = summarizePiToolArgs(toolName, record.args);
    return [{
      type: 'activity',
      message: detail ? `Running: ${toolName} ${detail}` : `Running: ${toolName}`,
      data: typeof record.toolCallId === 'string' ? { toolCallId: record.toolCallId, toolName } : { toolName },
    }];
  }

  if (record.type === 'auto_retry_start') {
    const attempt = typeof record.attempt === 'number' ? record.attempt : null;
    const maxAttempts = typeof record.maxAttempts === 'number' ? record.maxAttempts : null;
    const count = attempt !== null && maxAttempts !== null ? ` (${attempt}/${maxAttempts})` : '';
    const reason = typeof record.errorMessage === 'string' ? shortDetail(record.errorMessage) : '';
    return [{
      type: 'activity',
      message: `Retrying${count}${reason ? ` after: ${reason}` : ''}`,
      data: { attempt, maxAttempts },
    }];
  }

  if (record.type === 'compaction_start') {
    const reason = typeof record.reason === 'string' && PI_COMPACTION_REASONS.has(record.reason)
      ? record.reason
      : null;
    return [{
      type: 'activity',
      message: reason ? `Compacting context (${reason})` : 'Compacting context',
      data: { reason },
    }];
  }

  return [];
}

type PiEventListener = NonNullable<BackendRunOptions['onEvent']>;

function reportPiEvents(record: Record<string, unknown>, onEvent: PiEventListener): void {
  for (const event of piEventsFromRecord(record)) {
    try {
      onEvent(event);
    } catch {
      // Observers must never break a run.
    }
  }
}

/**
 * Progress for the batch path: fed raw stdout chunks by `spawnCli`. Only
 * lines that can carry an event are parsed; every `message_update` repeats
 * the whole message so far, and parsing those twice would cost for nothing.
 */
function createPiProgressTap(onEvent: PiEventListener): (chunk: string) => void {
  const splitter = createLineSplitter((line) => {
    if (
      !line.includes('"tool_execution_start"')
      && !line.includes('"auto_retry_start"')
      && !line.includes('"compaction_start"')
    ) return;
    const record = parsePiRecord(line);
    if (record) reportPiEvents(record, onEvent);
  });
  return (chunk) => splitter.push(chunk);
}

/**
 * Turns the records of a live run into the text to show. Every assistant
 * message is streamed, since a delta cannot wait for pi to say which message
 * is the last: whitespace at the start and end of each message is dropped
 * (trailing whitespace is held until more text follows), text blocks are
 * joined with a newline as in the batch answer, and a blank line separates
 * two messages that both produced text. Thinking and tool-call deltas are
 * never shown.
 */
function createPiTextAssembler(): { push(record: Record<string, unknown>): string } {
  let shownEarlier = false;
  let started = false;
  let held = '';
  let sawDelta = false;
  let lastIndex: unknown;

  const reset = (): void => {
    shownEarlier = shownEarlier || started;
    started = false;
    held = '';
    sawDelta = false;
    lastIndex = undefined;
  };

  const feed = (piece: string): string => {
    let body = held + piece;
    held = '';
    let lead = '';
    if (!started) {
      body = body.trimStart();
      if (!body) return '';
      started = true;
      if (shownEarlier) lead = '\n\n';
    }
    const visible = body.trimEnd();
    held = body.slice(visible.length);
    return lead + visible;
  };

  return {
    push(record) {
      if (record.type === 'message_update') {
        const event = asRecord(record.assistantMessageEvent);
        if (event?.type !== 'text_delta' || typeof event.delta !== 'string') return '';
        const nextBlock = sawDelta && event.contentIndex !== lastIndex;
        sawDelta = true;
        lastIndex = event.contentIndex;
        return feed(nextBlock ? `\n${event.delta}` : event.delta);
      }

      const message = asRecord(record.message);
      if (message?.role !== 'assistant') return '';
      if (record.type === 'message_start') {
        reset();
        return '';
      }
      if (record.type === 'message_end') {
        // Some providers send no deltas: the finished message is the text.
        const text = sawDelta ? '' : feed(piMessageText(message));
        reset();
        return text;
      }
      return '';
    },
  };
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
 * pi's `normalizeWindowsShellPath`: on Windows a Git Bash, MSYS, Cygwin or
 * WSL drive path (`/c/x`, `/mnt/c/x`, `/cygdrive/c/x`) names the same
 * directory as `C:\x`.
 */
function normalizeWindowsShellPath(filePath: string): string {
  if (!filePath.startsWith('/') || filePath.startsWith('//') || filePath.includes('\\')) return filePath;
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return filePath;
  const suffix = match[2]?.replaceAll('/', '\\');
  return `${match[1].toUpperCase()}:\\${suffix ?? ''}`;
}

/**
 * pi's `resolvePath` for a stored cwd: Windows shell paths rewritten (on
 * Windows only), `~` expansion, `file://` URLs, then lexical resolution
 * against pi's working directory, which is the repo. Throws where pi would,
 * e.g. a `file://` URL with a host. Every spelling pi accepts for one
 * directory has to resolve to the same string here, or the duplicate count
 * in `findPiSessionFiles` would come out lower than pi's. `platform` is a
 * parameter so the Windows rules are testable on any host.
 */
export function resolvePiStoredPath(
  stored: string,
  baseDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const windows = platform === 'win32';
  const path = windows ? win32 : posix;
  let normalized = windows ? normalizeWindowsShellPath(stored) : stored;
  if (normalized === '~') {
    normalized = homedir();
  } else if (normalized.startsWith('~/') || (windows && normalized.startsWith('~\\'))) {
    normalized = path.join(homedir(), normalized.slice(2));
  } else if (/^file:\/\//.test(normalized)) {
    normalized = fileURLToPath(normalized, { windows });
  }
  return path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(baseDir, normalized);
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
export function findPiSessionFiles(
  dir: string,
  id: string,
  repoCwd: string,
  platform: NodeJS.Platform = process.platform,
): PiSessionHeader[] {
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
      resolved = resolvePiStoredPath(cwd, repoCwd, platform);
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

/** How long pi gets to exit after SIGTERM before it is killed, on the batch and the stream path. */
export const PI_KILL_GRACE_MS = 2000;

function timeoutMessage(timeoutSeconds: number): string {
  return (
    `pi timed out after ${timeoutSeconds}s. If the model runs locally, check the server is up ` +
    "(your provider's baseUrl) and try a smaller model."
  );
}

/**
 * A nonzero exit. An invocation error sometimes follows a stream that already
 * carried a failed response; that message is the more useful one.
 */
function piExitError(
  exitCode: number | null,
  finalAssistant: Record<string, unknown> | null,
  stderr: string,
): PiBackendError {
  const failure = piFailureDetail(finalAssistant);
  if (failure) return new PiBackendError(`pi reported an error: ${describePiFailure(failure)}`);
  const tail = stderrTail(stderr);
  return new PiBackendError(`pi exited with code ${exitCode ?? 'unknown'}${tail ? `: ${tail}` : '.'}`);
}

/** Translate a failed run into a PiBackendError, preferring what pi itself reported. */
function toPiError(err: unknown, timeoutSeconds: number): PiBackendError {
  if (err instanceof PiBackendError) return err;
  if (err instanceof SpawnCliTimeoutError) return new PiBackendError(timeoutMessage(timeoutSeconds));
  if (err instanceof SpawnCliError) {
    return piExitError(err.exitCode, readPiJsonl(err.stdout).finalAssistant, err.stderr);
  }
  if (err instanceof BackendError) return new PiBackendError(err.message);
  return new PiBackendError(err instanceof Error ? err.message : String(err));
}

interface PiPreparedRun {
  args: string[];
  /** Canonical repo path: the spawn cwd and the session cwd pi records. */
  repoCwd: string;
  session: PiSessionPlan | null;
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

  /**
   * Everything that happens before a spawn, shared by `run()` and
   * `runStream()` so neither can skip a check.
   */
  private async prepare(opts: BackendRunOptions): Promise<PiPreparedRun> {
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
    return { args, repoCwd, session };
  }

  async run(opts: BackendRunOptions): Promise<string> {
    const { args, repoCwd, session } = await this.prepare(opts);

    try {
      const result = await spawnCli('pi', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: repoCwd,
        label: 'pi',
        // Same bound as the stream path: a pi that ignores SIGTERM is killed.
        killGraceMs: PI_KILL_GRACE_MS,
        // Review, --schema and session calls all take this path, and those
        // are the long tool-using runs where progress matters.
        onStdout: opts.onEvent ? createPiProgressTap(opts.onEvent) : undefined,
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

  async *runStream(opts: BackendRunOptions): AsyncGenerator<string> {
    const { args, repoCwd, session } = await this.prepare(opts);

    const child = spawn('pi', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: repoCwd,
      env: opts.env,
    });

    // The verdict is derived after stdout is fully read, so the exit status
    // is only recorded here. A failed spawn reports `error` and may never
    // report `close`.
    let ended = false;
    let spawnFailure: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      const finish = (code: number | null, signal: string | null): void => {
        ended = true;
        if (killTimer) clearTimeout(killTimer);
        resolve({ code, signal });
      };
      child.once('error', (err) => {
        spawnFailure = err;
        finish(null, null);
      });
      child.once('close', (code, signal) => finish(code, signal as string | null));
    });

    // Every wait on `exit` below is bounded by this: a child that ignores
    // SIGTERM is killed after the grace period.
    const terminate = (): void => {
      if (ended) return;
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => {
        if (!ended) child.kill('SIGKILL');
      }, PI_KILL_GRACE_MS);
    };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, opts.timeoutSeconds * 1000);

    const onSigint = () => { terminate(); };
    process.on('SIGINT', onSigint);

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const transcript: PiTranscript = { header: null, finalAssistant: null };
    const assembler = createPiTextAssembler();

    try {
      let readFailure: unknown = null;
      try {
        for await (const record of piRecords(child.stdout as Readable)) {
          notePiRecord(transcript, record);
          if (opts.onEvent) reportPiEvents(record, opts.onEvent);
          const text = assembler.push(record);
          if (text) yield text;
        }
      } catch (err: unknown) {
        readFailure = err;
        terminate();
      }

      const { code, signal } = await exit;
      const stderr = Buffer.concat(stderrChunks).toString().trim();

      if (spawnFailure) {
        throw new PiBackendError(`pi failed to start: ${(spawnFailure as Error).message}`);
      }
      if (timedOut) throw new PiBackendError(timeoutMessage(opts.timeoutSeconds));
      // Before the signal check: a read failure is why the child was killed.
      if (readFailure) {
        throw new PiBackendError(
          `pi stream error: ${readFailure instanceof Error ? readFailure.message : String(readFailure)}`,
        );
      }
      if (signal) throw new PiBackendError(`pi killed by signal ${signal}`);
      if (code !== 0 && code !== null) throw piExitError(code, transcript.finalAssistant, stderr);

      // Same end-state rules as the batch path; the text itself was streamed.
      piAnswer(transcript, { stderr });
      if (session) {
        confirmPiSession(session, transcript.header, stderr, repoCwd);
        opts.onSessionCreated?.(session.id);
      }
    } catch (err: unknown) {
      throw toPiError(err, opts.timeoutSeconds);
    } finally {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      // Reached early when the consumer stops reading: do not leave pi
      // running, and do not return before it is gone.
      if (!ended) {
        terminate();
        await exit;
      }
    }
  }
}

export const PI_BACKEND = new PiBackend();
registerBackend(PI_BACKEND);

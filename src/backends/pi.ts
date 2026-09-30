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

import { BackendError, type SandboxMode } from './index.js';

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

/**
 * Grok Build CLI backend.
 *
 * Headless `grok --prompt-file`. Batch mode uses `--output-format json`.
 * Streaming uses `--output-format streaming-json` (one ACP-derived event per
 * line). Sandbox and permission mode are separate: the sandbox limits an
 * approved call, and `dontAsk` (limited modes) or `bypassPermissions` (full
 * access) keeps the relay from sitting on an approval prompt until timeout.
 * `acceptEdits` is not used: an unmatched Bash call still prompts, which
 * hangs the relay.
 *
 * Sessions are native. `-s` / `--session-id` names a new UUID and does not
 * resume. A later call continues with `--resume <id>`. `--json-schema`
 * constrains the batch envelope. There is no native review subcommand.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { Readable } from 'node:stream';
import {
  BackendError,
  SpawnCliError,
  SpawnCliTimeoutError,
  registerBackend,
  spawnCli,
  type Backend,
  type BackendCapabilities,
  type BackendEvent,
  type BackendRunOptions,
  type SandboxMode,
} from './index.js';

export class GrokBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'GrokBackendError';
  }
}

// grok 1.0.62 reports end_turn; retain the existing stop/length contract.
const FINISHED_STOP_REASONS = new Set(['stop', 'length', 'end_turn']);

/**
 * Grok sets `GROK_AGENT=1` on every child it launches. `PHONE_A_FRIEND_HOST=grok`
 * is the explicit marker the skill sets, including for a caller that did not
 * arrive through Grok's shell.
 */
export function isGrokHostEnv(env: Record<string, string | undefined>): boolean {
  return env.GROK_AGENT === '1' || env.PHONE_A_FRIEND_HOST?.toLowerCase() === 'grok';
}

function assertNotGrokHost(env: Record<string, string>): void {
  if (!isGrokHostEnv(env)) return;
  throw new GrokBackendError(
    'Grok is already the host for this Phone-a-Friend invocation. ' +
      'Choose another friend backend such as antigravity, codex, gemini, claude, opencode, pi, or ollama.',
  );
}

export function isFinishedGrokStop(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  return FINISHED_STOP_REASONS.has(reason);
}

export interface GrokArgOptions {
  promptFile: string;
  repoPath: string;
  sandbox: SandboxMode;
  model: string | null;
  outputFormat?: 'json' | 'streaming-json';
  schema?: string | null;
  sessionId?: string | null;
  resumeSession?: boolean;
}

/**
 * Arguments for one headless run. `--fast` is intentionally absent: Grok has
 * no flag that skips project instructions, so a fast request adds nothing.
 */
export function buildGrokArgs(opts: GrokArgOptions): string[] {
  const args = [
    '--no-auto-update',
    '--output-format', opts.outputFormat ?? 'json',
    '--cwd', opts.repoPath,
    '--prompt-file', opts.promptFile,
  ];
  if (opts.model) args.push('-m', opts.model);
  if (opts.schema) args.push('--json-schema', opts.schema);
  if (opts.sessionId) {
    // --session-id creates a new UUID. Resume is a different flag.
    args.push(opts.resumeSession ? '--resume' : '--session-id', opts.sessionId);
  }

  // grok 1.0.62 lists dontAsk and bypassPermissions in `grok --help`.
  // Documented allow filters are Bash, Edit, Read, Grep, MCPTool, WebFetch,
  // and WebSearch. Edit creates files; there is no Write filter, and an
  // unknown allow name is ignored. CLI --allow merges with project rules,
  // and deny wins over allow. dontAsk still honors a project Edit allow, and
  // the read-only sandbox permits writes under /tmp and ~/.grok, so read-only
  // denies Edit as well as Bash. acceptEdits would still prompt for Bash.
  switch (opts.sandbox) {
    case 'read-only':
      args.push(
        '--sandbox', 'read-only',
        '--permission-mode', 'dontAsk',
        '--allow', 'Read',
        '--allow', 'Grep',
        '--deny', 'Bash',
        '--deny', 'Edit',
      );
      break;
    case 'workspace-write':
      args.push(
        '--sandbox', 'workspace',
        '--permission-mode', 'dontAsk',
        '--allow', 'Read',
        '--allow', 'Grep',
        '--allow', 'Edit',
        '--deny', 'Bash',
      );
      break;
    case 'danger-full-access':
      args.push('--sandbox', 'off', '--permission-mode', 'bypassPermissions');
      break;
  }
  return args;
}

export interface GrokParsedResult {
  text: string;
  sessionId: string | null;
}

function structuredText(record: Record<string, unknown>): string | null {
  const key = Object.hasOwn(record, 'structured_output') ? 'structured_output' : 'structuredOutput';
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Pull the answer out of Grok's `--output-format json` envelope.
 * Exit 0 is not success: only a finished stop reason with text is an answer.
 * With `--json-schema`, `structured_output` is the answer when Grok sets it.
 */
export function parseGrokEnvelope(stdout: string, opts: { schema?: boolean } = {}): GrokParsedResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new GrokBackendError('Grok returned output that is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GrokBackendError('Grok returned JSON that is not a result object.');
  }
  const record = parsed as Record<string, unknown>;
  if (record.type === 'error') {
    const message = typeof record.message === 'string' && record.message.trim() !== ''
      ? record.message.trim()
      : 'Grok returned an error envelope.';
    throw new GrokBackendError(`Grok returned an error: ${message}`);
  }
  const sessionId = typeof record.sessionId === 'string' && record.sessionId.trim() !== ''
    ? record.sessionId
    : null;
  const structured = opts.schema ? structuredText(record) : null;
  const text = structured ?? record.text;
  if (
    isFinishedGrokStop(record.stopReason) &&
    typeof text === 'string' &&
    text.trim() !== ''
  ) {
    return { text, sessionId };
  }
  const reason = typeof record.stopReason === 'string' ? record.stopReason : 'missing';
  throw new GrokBackendError(`Grok did not return a finished answer (stopReason: ${reason}).`);
}

export function parseGrokResult(stdout: string): string {
  return parseGrokEnvelope(stdout).text;
}

export interface GrokStreamPiece {
  text: string;
  activity: string | null;
  sessionId: string | null;
  finished: boolean;
  stopReason: string | null;
  error: string | null;
}

function textFromAcpUpdate(record: Record<string, unknown>): string {
  const params = record.params;
  if (!params || typeof params !== 'object') return '';
  const update = (params as Record<string, unknown>).update;
  if (!update || typeof update !== 'object') return '';
  const body = update as Record<string, unknown>;
  if (body.sessionUpdate !== 'agent_message_chunk') return '';
  const content = body.content;
  if (!content || typeof content !== 'object') return '';
  const chunk = content as Record<string, unknown>;
  return chunk.type === 'text' && typeof chunk.text === 'string' ? chunk.text : '';
}

/**
 * One `streaming-json` line. `text` events are answer chunks. Thoughts are
 * dropped. A raw ACP `session/update` line is accepted too, in case the
 * projector is not applied. Unknown types are ignored.
 */
export function interpretGrokStreamLine(line: string): GrokStreamPiece {
  const empty: GrokStreamPiece = {
    text: '',
    activity: null,
    sessionId: null,
    finished: false,
    stopReason: null,
    error: null,
  };
  const trimmed = line.trim();
  if (!trimmed) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const record = parsed as Record<string, unknown>;

  if (typeof record.type !== 'string') {
    return { ...empty, text: textFromAcpUpdate(record) };
  }

  if (record.type === 'error') {
    const message = typeof record.message === 'string' && record.message.trim() !== ''
      ? record.message.trim()
      : 'Grok returned an error envelope.';
    return { ...empty, error: `Grok returned an error: ${message}` };
  }
  if (record.type === 'text' && typeof record.data === 'string') {
    return { ...empty, text: record.data };
  }
  if (record.type === 'tool_call') {
    const name = typeof record.toolName === 'string' && record.toolName.trim() !== ''
      ? record.toolName.trim()
      : 'tool';
    return { ...empty, activity: `Running: ${name}` };
  }
  if (record.type === 'end') {
    return {
      ...empty,
      finished: true,
      stopReason: typeof record.stopReason === 'string' ? record.stopReason : null,
      sessionId: typeof record.sessionId === 'string' && record.sessionId.trim() !== ''
        ? record.sessionId
        : null,
    };
  }
  return empty;
}

function canonicalRepoPath(repoPath: string): string {
  try {
    return realpathSync(resolvePath(repoPath));
  } catch (err) {
    throw new GrokBackendError(
      `Repository path cannot be resolved: ${repoPath} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function writePromptFile(prompt: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'paf-grok-'));
  const file = join(dir, 'prompt.txt');
  try {
    writeFileSync(file, prompt, 'utf8');
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, file };
}

function grokFailureText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
      return parsed.message.trim().slice(0, 500);
    }
  } catch {
    // Non-JSON stdout is still the best failure detail Grok left us.
  }
  return trimmed.slice(0, 500);
}

const GROK_KILL_GRACE_MS = 2_000;

function toGrokError(err: unknown, timeoutSeconds: number): GrokBackendError {
  if (err instanceof GrokBackendError) return err;
  if (err instanceof SpawnCliTimeoutError) {
    return new GrokBackendError(`Grok timed out after ${timeoutSeconds}s`);
  }
  if (err instanceof SpawnCliError) {
    const detail = err.stderr.trim() || grokFailureText(err.stdout) || err.message;
    return new GrokBackendError(
      `Grok exited with code ${err.exitCode ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
    );
  }
  if (err instanceof BackendError) return new GrokBackendError(err.message);
  return new GrokBackendError(err instanceof Error ? err.message : String(err));
}

function grokRunArgs(opts: BackendRunOptions, promptFile: string, repoCwd: string, outputFormat: 'json' | 'streaming-json'): string[] {
  return buildGrokArgs({
    promptFile,
    repoPath: repoCwd,
    sandbox: opts.sandbox,
    model: opts.model,
    outputFormat,
    schema: outputFormat === 'json' ? opts.schema : null,
    sessionId: opts.sessionId,
    resumeSession: opts.resumeSession,
  });
}

export class GrokBackend implements Backend {
  readonly name = 'grok';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'native-session',
    requiresClientSessionId: true,
  };

  async run(opts: BackendRunOptions): Promise<string> {
    assertNotGrokHost(opts.env);

    const repoCwd = canonicalRepoPath(opts.repoPath);
    const promptFile = writePromptFile(opts.prompt);
    try {
      const result = await spawnCli('grok', grokRunArgs(opts, promptFile.file, repoCwd, 'json'), {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: repoCwd,
        label: 'grok',
        killGraceMs: GROK_KILL_GRACE_MS,
      });
      const parsed = parseGrokEnvelope(result.stdout, { schema: Boolean(opts.schema) });
      const sessionId = parsed.sessionId ?? opts.sessionId ?? null;
      if (sessionId) opts.onSessionCreated?.(sessionId);
      return parsed.text;
    } catch (err: unknown) {
      throw toGrokError(err, opts.timeoutSeconds);
    } finally {
      rmSync(promptFile.dir, { recursive: true, force: true });
    }
  }

  async *runStream(opts: BackendRunOptions): AsyncGenerator<string> {
    assertNotGrokHost(opts.env);
    if (opts.schema) {
      throw new GrokBackendError(
        'Grok structured output uses batch JSON. Do not combine --schema or --verdict-json with streaming.',
      );
    }

    const repoCwd = canonicalRepoPath(opts.repoPath);
    const promptFile = writePromptFile(opts.prompt);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('grok', grokRunArgs(opts, promptFile.file, repoCwd, 'streaming-json'), {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: repoCwd,
        env: opts.env,
      });
    } catch (err) {
      rmSync(promptFile.dir, { recursive: true, force: true });
      throw toGrokError(err, opts.timeoutSeconds);
    }
    // Preserve multi-byte characters split across stdout chunks.
    child.stdout?.setEncoding('utf8');

    let ended = false;
    let spawnError: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      const finish = (code: number | null, signal: string | null): void => {
        ended = true;
        if (killTimer) clearTimeout(killTimer);
        resolve({ code, signal });
      };
      child.once('error', (err) => { spawnError = err; });
      child.once('close', (code, signal) => finish(code, signal));
    });
    const terminate = (): void => {
      if (ended) return;
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => {
        if (!ended) child.kill('SIGKILL');
      }, GROK_KILL_GRACE_MS);
    };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, opts.timeoutSeconds * 1000);
    let interrupted = false;
    const onSigint = (): void => { interrupted = true; terminate(); };
    const onStdoutError = (): void => { terminate(); };
    process.on('SIGINT', onSigint);
    process.stdout.on('error', onStdoutError);

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let buffer = '';
    let hasText = false;
    let finished = false;
    let sessionId: string | null = opts.sessionId ?? null;
    let streamError: unknown = null;

    const take = (piece: GrokStreamPiece): string => {
      if (piece.error) throw new GrokBackendError(piece.error);
      if (piece.activity && opts.onEvent) {
        const event: BackendEvent = { type: 'activity', message: piece.activity };
        opts.onEvent(event);
      }
      if (piece.sessionId) sessionId = piece.sessionId;
      if (piece.finished) {
        finished = true;
        if (!isFinishedGrokStop(piece.stopReason)) {
          const reason = piece.stopReason ?? 'missing';
          throw new GrokBackendError(`Grok did not return a finished answer (stopReason: ${reason}).`);
        }
      }
      return piece.text;
    };

    try {
      try {
        for await (const chunk of child.stdout as Readable) {
          buffer += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const text = take(interpretGrokStreamLine(line));
            if (text) {
              hasText ||= text.trim() !== '';
              yield text;
            }
          }
        }
        if (buffer.trim()) {
          const text = take(interpretGrokStreamLine(buffer));
          if (text) {
            hasText ||= text.trim() !== '';
            yield text;
          }
        }
      } catch (err: unknown) {
        streamError = err;
        terminate();
      }

      const { code, signal } = await exit;
      const stderr = Buffer.concat(stderrChunks).toString().trim();
      if (timedOut) throw new GrokBackendError(`Grok timed out after ${opts.timeoutSeconds}s`);
      if (spawnError) throw spawnError;
      if (interrupted) throw new GrokBackendError('Grok interrupted by SIGINT');
      if (streamError) throw streamError;
      if (signal) throw new GrokBackendError(`Grok killed by signal ${signal}`);
      if (code !== 0) {
        throw new GrokBackendError(`Grok exited with code ${code}${stderr ? `: ${stderr}` : ''}`);
      }
      if (!finished) throw new GrokBackendError('Grok did not return a finished answer (stopReason: missing).');
      if (!hasText) throw new GrokBackendError('Grok did not return a finished answer (stopReason: missing).');
      if (sessionId) opts.onSessionCreated?.(sessionId);
    } catch (err: unknown) {
      throw toGrokError(err, opts.timeoutSeconds);
    } finally {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      process.stdout.removeListener('error', onStdoutError);
      if (!ended) {
        terminate();
        await exit;
      }
      rmSync(promptFile.dir, { recursive: true, force: true });
    }
  }
}

export const GROK_BACKEND = new GrokBackend();
registerBackend(GROK_BACKEND);

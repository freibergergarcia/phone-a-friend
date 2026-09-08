/**
 * Codex backend implementation.
 *
 * Ported from phone_a_friend/backends/codex.py
 */

import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import {
  type BackendCapabilities,
  type BackendEvent,
  type BackendRunOptions,
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  SpawnCliError,
  spawnCli,
  type Backend,
  type ReviewOptions,
  type ReviewScope,
  type SandboxMode,
} from './index.js';

export class CodexBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'CodexBackendError';
  }
}

/**
 * Detect when the current PaF invocation is running inside Codex. The Codex
 * skill shims set `PHONE_A_FRIEND_HOST=codex` (mirroring the OpenCode
 * convention) so PaF can refuse to recurse into Codex as a backend.
 *
 * We do NOT match generic `CODEX_*` env vars: users frequently export
 * `CODEX_HOME` or similar in their shell rc, and that should not block a
 * legitimate `phone-a-friend --to codex` from a regular terminal.
 */
export function isCodexHostEnv(env: Record<string, string | undefined>): boolean {
  return env.PHONE_A_FRIEND_HOST?.toLowerCase() === 'codex';
}

function assertNotCodexHost(env: Record<string, string>): void {
  if (!isCodexHostEnv(env)) return;
  throw new CodexBackendError(
    'Codex is already the host for this Phone-a-Friend invocation. ' +
      'Choose another friend backend such as antigravity, claude, gemini, opencode, or ollama.',
  );
}

export class CodexBackend implements Backend {
  readonly name = 'codex';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'native-session',
    requiresClientSessionId: false,
  };
  readonly nativeReviewScopes: ReadonlySet<ReviewScope> = new Set(['branch', 'working-tree']);

  async run(opts: BackendRunOptions): Promise<string> {
    assertNotCodexHost(opts.env);
    // Keep PATH and the rest of the environment identical for preflight and run.
    const env = { ...opts.env };
    if (!isInPath('codex', env)) {
      throw new CodexBackendError(
        `codex CLI not found in PATH. Install it: ${INSTALL_HINTS.codex}`,
      );
    }

    if (opts.schema && opts.resumeSession && opts.sessionId) {
      await assertResumeSchemaSupport(env, opts.timeoutSeconds * 1000);
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'phone-a-friend-'));
    const outputPath = join(tmpDir, 'codex-last-message.txt');
    const schemaPath = opts.schema ? join(tmpDir, 'codex-output-schema.json') : null;

    try {
      const args = buildCodexExecArgs({
        prompt: opts.prompt,
        repoPath: opts.repoPath,
        sandbox: opts.sandbox,
        model: opts.model,
        outputPath,
        schemaPath,
        persistSession: opts.persistSession ?? false,
        sessionId: opts.sessionId ?? null,
        resumeSession: opts.resumeSession ?? false,
        wantsJson: Boolean(opts.onEvent),
      });
      const jsonRequested = args.includes('--json');
      const tap = opts.onEvent ? createCodexJsonlTap(opts.onEvent) : undefined;

      if (schemaPath) {
        writeSchemaFile(schemaPath, opts.schema ?? '');
      }

      let stdout = '';
      try {
        const result = await spawnCli('codex', args, {
          timeoutMs: opts.timeoutSeconds * 1000,
          env,
          label: 'codex exec',
          onStdout: tap,
        });
        tap?.flush();
        stdout = result.stdout;
        maybeEmitSessionId(stdout, opts.onSessionCreated);
      } catch (err: unknown) {
        tap?.flush();
        if (err instanceof SpawnCliError) {
          maybeEmitSessionId(err.stdout, opts.onSessionCreated);
        }

        // On failure, check if codex wrote a useful last-message before dying
        const lastMessage = readOutputFile(outputPath);
        if (lastMessage) return lastMessage;

        if (err instanceof BackendError) {
          throw new CodexBackendError(err.message);
        }
        throw err;
      }

      // Read output file (preferred)
      const lastMessage = readOutputFile(outputPath);
      if (lastMessage) {
        return lastMessage;
      }

      // Fall back to stdout. With JSONL requested, stdout is an event stream,
      // so surface the final agent message rather than raw protocol lines.
      const fallback = jsonRequested ? extractCodexFinalMessage(stdout) : stdout;
      if (fallback) {
        return fallback;
      }

      throw new CodexBackendError('codex exec completed without producing feedback');
    } finally {
      // Clean up temp directory
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  async review(opts: ReviewOptions): Promise<string> {
    assertNotCodexHost(opts.env);
    if (!isInPath('codex')) {
      throw new CodexBackendError(
        `codex CLI not found in PATH. Install it: ${INSTALL_HINTS.codex}`,
      );
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'phone-a-friend-'));
    const outputPath = join(tmpDir, 'codex-last-message.txt');

    try {
      // codex exec review does not accept -C or --sandbox; use cwd instead
      const reviewTargetArgs = opts.scope === 'working-tree'
        ? ['--uncommitted']
        : ['--base', opts.base];
      const args = [
        'exec',
        'review',
        ...reviewTargetArgs,
        '--output-last-message',
        outputPath,
        '--skip-git-repo-check',
      ];
      const jsonRequested = Boolean(opts.onEvent);
      if (jsonRequested) {
        args.push('--json');
      }
      const tap = opts.onEvent ? createCodexJsonlTap(opts.onEvent) : undefined;

      if (opts.model) {
        args.push('-m', opts.model);
      }

      // codex exec review: --base and positional [PROMPT] are mutually exclusive.
      // When --base is used, omit the custom prompt (review uses the diff as context).
      // Custom prompts with --base fall through to the generic run() path in relay.ts.
      if (opts.prompt && !opts.base) {
        args.push(opts.prompt);
      }

      let stdout = '';
      try {
        const result = await spawnCli('codex', args, {
          timeoutMs: opts.timeoutSeconds * 1000,
          env: opts.env,
          cwd: opts.repoPath,
          label: 'codex exec review',
          onStdout: tap,
        });
        tap?.flush();
        stdout = result.stdout;
      } catch (err: unknown) {
        tap?.flush();
        // On failure, check if codex wrote a useful last-message before dying
        const lastMessage = readOutputFile(outputPath);
        if (lastMessage) return lastMessage;

        if (err instanceof BackendError) {
          throw new CodexBackendError(err.message);
        }
        throw err;
      }

      const lastMessage = readOutputFile(outputPath);
      if (lastMessage) {
        return lastMessage;
      }

      const fallback = jsonRequested ? extractCodexFinalMessage(stdout) : stdout;
      if (fallback) {
        return fallback;
      }

      throw new CodexBackendError('codex exec review completed without producing feedback');
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

interface CodexExecArgsOptions {
  prompt: string;
  repoPath: string;
  sandbox: SandboxMode;
  model: string | null;
  outputPath: string;
  schemaPath: string | null;
  persistSession: boolean;
  sessionId: string | null;
  resumeSession: boolean;
  /** Request JSONL events even for ephemeral runs (progress observers). */
  wantsJson?: boolean;
}

interface CodexMetadata {
  threadId?: string;
  usage?: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
  failed?: boolean;
}

function buildCodexExecArgs(opts: CodexExecArgsOptions): string[] {
  const isResume = opts.resumeSession && opts.sessionId;
  const args = isResume
    ? ['exec', 'resume', opts.sessionId!]
    : ['exec'];

  // Resume has its own option set; repository and sandbox flags remain exec-only.
  if (isResume) {
    args.push('-o', opts.outputPath);
  } else {
    args.push(
      '-C',
      opts.repoPath,
      '--sandbox',
      opts.sandbox,
      '--output-last-message',
      opts.outputPath,
    );
  }

  args.push('--skip-git-repo-check');

  if (!isResume && !opts.persistSession) {
    args.push('--ephemeral');
  }

  // Resume schema support is checked against the invoked CLI before reaching here.
  if (opts.schemaPath) {
    args.push('--output-schema', opts.schemaPath, '--json');
  } else if (opts.persistSession || isResume || opts.wantsJson) {
    args.push('--json');
  }

  if (opts.model) {
    args.push('-m', opts.model);
  }

  args.push(opts.prompt);
  return args;
}

/** Probe only schema resumes, without model work or a cache shared across PATHs. */
function assertResumeSchemaSupport(env: Record<string, string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('codex', ['exec', 'resume', '--help'], {
      env,
      encoding: 'utf8',
      timeout: Math.max(1, Math.min(timeoutMs, 3000)),
      killSignal: 'SIGKILL',
      maxBuffer: 128 * 1024,
    }, (err, stdout) => {
      if (err) {
        reject(new CodexBackendError(
          'Could not verify Codex resume schema support: `codex exec resume --help` failed. ' +
          'Check the codex executable in this invocation\'s PATH; the schema request was not run.',
        ));
      } else if (!/^\s*--output-schema(?:\s|=|$)/m.test(stdout)) {
        reject(new CodexBackendError(
          'The codex executable in this invocation\'s PATH does not advertise --output-schema ' +
          'for exec resume. Upgrade or select a supporting Codex CLI to resume with a schema; ' +
          'the schema request was not run.',
        ));
      } else {
        resolve();
      }
    });
  });
}

function writeSchemaFile(schemaPath: string, schema: string): void {
  try {
    writeFileSync(schemaPath, schema, 'utf-8');
  } catch (err) {
    throw new CodexBackendError(`Failed writing Codex schema file: ${err}`);
  }
}

function maybeEmitSessionId(
  jsonlOutput: string,
  onSessionCreated?: (sessionId: string) => void,
): void {
  const threadId = parseCodexMetadata(jsonlOutput).threadId;
  if (threadId && onSessionCreated) {
    onSessionCreated(threadId);
  }
}

export function parseCodexMetadata(jsonlOutput: string): CodexMetadata {
  const meta: CodexMetadata = {};
  for (const line of jsonlOutput.trim().split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        meta.threadId = event.thread_id;
      }
      if (event.type === 'turn.completed' && typeof event.usage === 'object' && event.usage !== null) {
        meta.usage = event.usage as CodexMetadata['usage'];
      }
      if (event.type === 'turn.failed') {
        meta.failed = true;
      }
    } catch {
      // Ignore malformed JSONL lines from mixed stdout.
    }
  }
  return meta;
}

function readOutputFile(outputPath: string): string {
  if (!existsSync(outputPath)) {
    return '';
  }
  try {
    return readFileSync(outputPath, 'utf-8').trim();
  } catch (err) {
    throw new CodexBackendError(
      `Failed reading Codex output file: ${err}`,
    );
  }
}

// ---------------------------------------------------------------------------
// JSONL progress events
// ---------------------------------------------------------------------------
//
// Event and item shapes follow codex-rs/exec/src/exec_events.rs: events are
// tagged by `type` (thread.started, turn.*, item.*, error) and items carry a
// flattened `type` (agent_message, reasoning, command_execution, file_change,
// mcp_tool_call, web_search, todo_list, error). Reasoning is private and is
// never surfaced.

const MAX_EVENT_COMMAND_CHARS = 200;
const MAX_EVENT_MESSAGE_CHARS = 300;

function truncateForEvent(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

function itemEvents(phase: string, item: unknown): BackendEvent[] {
  if (!item || typeof item !== 'object') return [];
  const record = item as Record<string, unknown>;
  const itemId = typeof record.id === 'string' ? record.id : undefined;
  const status = typeof record.status === 'string' ? record.status : undefined;

  switch (record.type) {
    case 'command_execution': {
      const command = truncateForEvent(String(record.command ?? ''), MAX_EVENT_COMMAND_CHARS);
      if (phase === 'item.started') {
        return [{ type: 'activity', message: `Running: ${command}`, data: { itemId, status } }];
      }
      if (phase === 'item.completed') {
        const exitCode = typeof record.exit_code === 'number' ? record.exit_code : null;
        return [{
          type: 'activity',
          message: `Finished (exit ${exitCode ?? 'n/a'}): ${command}`,
          data: { itemId, status, exitCode },
        }];
      }
      return [];
    }
    case 'agent_message': {
      if (phase !== 'item.completed') return [];
      const text = typeof record.text === 'string' ? record.text : '';
      return [{
        type: 'message',
        message: truncateForEvent(text, MAX_EVENT_MESSAGE_CHARS),
        data: { itemId, length: text.length },
      }];
    }
    case 'file_change': {
      if (phase !== 'item.completed') return [];
      const changes = Array.isArray(record.changes) ? record.changes : [];
      const files = changes
        .map((change) => (change && typeof change === 'object' && typeof (change as Record<string, unknown>).path === 'string'
          ? (change as Record<string, unknown>).path as string
          : null))
        .filter((path): path is string => path !== null);
      return [{ type: 'activity', message: `Changed ${changes.length} file(s)`, data: { itemId, status, files } }];
    }
    case 'mcp_tool_call': {
      if (phase === 'item.updated') return [];
      return [{
        type: 'activity',
        message: `Tool call: ${String(record.server ?? '?')}/${String(record.tool ?? '?')}`,
        data: { itemId, status },
      }];
    }
    case 'web_search': {
      if (phase === 'item.updated') return [];
      return [{ type: 'activity', message: `Web search: ${String(record.query ?? '')}`, data: { itemId } }];
    }
    case 'error': {
      if (phase !== 'item.completed') return [];
      return [{ type: 'error', message: String(record.message ?? 'Codex item error'), data: { itemId } }];
    }
    default:
      // reasoning, todo_list, collab_tool_call: not surfaced.
      return [];
  }
}

/** Map one JSONL line from `codex exec --json` to zero or more backend events. */
export function codexEventsFromLine(line: string): BackendEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];
    event = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  switch (event.type) {
    case 'thread.started': {
      const id = typeof event.thread_id === 'string' ? event.thread_id : null;
      return id
        ? [{ type: 'session_linked', message: `Codex thread ${id}`, data: { backendSessionId: id } }]
        : [];
    }
    case 'turn.started':
      return [{ type: 'turn_started', message: 'Codex turn started' }];
    case 'turn.completed':
      return [{ type: 'turn_completed', message: 'Codex turn completed', data: { usage: event.usage ?? null } }];
    case 'turn.failed': {
      const error = event.error as Record<string, unknown> | undefined;
      const message = typeof error?.message === 'string' ? error.message : 'unknown error';
      return [{ type: 'turn_failed', message: `Codex turn failed: ${message}` }];
    }
    case 'error':
      return [{ type: 'error', message: typeof event.message === 'string' ? event.message : 'Codex error' }];
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return itemEvents(event.type, event.item);
    default:
      return [];
  }
}

export interface CodexJsonlTap {
  (chunk: string): void;
  /** Emit events for a trailing line that never received a newline. */
  flush(): void;
}

/** Line-buffer stdout chunks and forward parsed events. Observer errors are swallowed. */
export function createCodexJsonlTap(onEvent: (event: BackendEvent) => void): CodexJsonlTap {
  let buffer = '';
  const emitLine = (line: string): void => {
    for (const event of codexEventsFromLine(line)) {
      try {
        onEvent(event);
      } catch {
        // Observers must never break the run.
      }
    }
  };
  const tap = ((chunk: string): void => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      emitLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }) as CodexJsonlTap;
  tap.flush = (): void => {
    if (buffer.trim()) emitLine(buffer);
    buffer = '';
  };
  return tap;
}

/** The text of the last completed agent message in a JSONL stream, or ''. */
export function extractCodexFinalMessage(jsonlOutput: string): string {
  let last = '';
  for (const line of jsonlOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const item = event?.item as Record<string, unknown> | undefined;
      if (event?.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
        last = item.text;
      }
    } catch {
      // Ignore malformed JSONL lines from mixed stdout.
    }
  }
  return last.trim();
}

export const CODEX_BACKEND = new CodexBackend();
registerBackend(CODEX_BACKEND);

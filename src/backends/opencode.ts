/**
 * OpenCode CLI backend implementation.
 *
 * Subprocess backend using `opencode run` with `--format json` for parseable
 * NDJSON output. Unlike the Ollama HTTP backend (pure inference), OpenCode
 * provides agentic capabilities: tool calling, native file access via --dir,
 * and SQLite-backed session persistence.
 *
 * Sandbox is a no-op — OpenCode manages its own tool permissions internally.
 */

import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  type BackendCapabilities,
  type BackendRunOptions,
  type ReviewOptions,
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  spawnCli,
  type Backend,
  type SandboxMode,
} from './index.js';
import { parseOpenCodeStreamJSON } from '../stream-parsers.js';
import { loadConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class OpenCodeBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCodeBackendError';
  }
}

// Emitted when opencode closes cleanly but the parser saw zero text parts
// (typically only step_start events). Root cause lives in opencode's build
// agent — under --format json it sometimes terminates after the initial
// step without finalizing a text reply. Affects both batch and streaming
// callers, so the message lives here and is reused in run() and runStream().
const OPENCODE_NO_OUTPUT_MESSAGE =
  'opencode produced no text output. The build agent may have terminated mid tool-call without finalizing a reply. ' +
  'Try a more direct prompt, or use antigravity/codex/gemini/claude for one-shot relays.';

const OPENCODE_REVIEW_NO_OUTPUT_MESSAGE =
  'opencode review produced no text output. The build agent may have terminated mid tool-call without finalizing a reply. Try a different backend (antigravity, codex, gemini, claude) for this review.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeOpenCodeModel(
  model: string | null,
  provider = 'ollama',
): string | null {
  if (!model) return null;
  return model.includes('/') ? model : `${provider}/${model}`;
}

interface OpenCodeRunArgsOptions {
  prompt: string;
  repoPath: string;
  model: string | null;
  provider?: string;
  fast: boolean;
  sessionId: string | null;
  resumeSession: boolean;
  title?: string | null;
}

export function isOpenCodeHostEnv(env: Record<string, string | undefined>): boolean {
  // Block only on the explicit marker. The OpenCode install shims set
  // PHONE_A_FRIEND_HOST=opencode when invoking PaF; that's the reliable
  // signal under our control.
  //
  // We previously also matched any env var prefixed with OPENCODE_ as a
  // best-effort fallback, but it produced false positives for users with
  // OPENCODE_SERVER_PASSWORD or similar in their shell rc, blocking
  // legitimate `phone-a-friend --to opencode` calls from a regular terminal.
  return env.PHONE_A_FRIEND_HOST?.toLowerCase() === 'opencode';
}

function assertNotOpenCodeHost(env: Record<string, string>): void {
  if (!isOpenCodeHostEnv(env)) return;
  throw new OpenCodeBackendError(
    'OpenCode is already the host for this Phone-a-Friend invocation. ' +
      'Choose another friend backend such as antigravity, codex, gemini, claude, or ollama.',
  );
}

export function buildOpenCodeArgs(opts: OpenCodeRunArgsOptions): string[] {
  const args = ['run', '--format', 'json', '--dir', opts.repoPath];

  const model = normalizeOpenCodeModel(opts.model, opts.provider);
  if (model) args.push('--model', model);
  if (opts.fast) args.push('--pure');

  if (opts.resumeSession && opts.sessionId) {
    args.push('--session', opts.sessionId);
  } else if (opts.title) {
    args.push('--title', opts.title);
  }

  args.push(opts.prompt);
  return args;
}

/**
 * Parse batch JSONL output from `opencode run --format json`.
 *
 * Event types (verified via discovery):
 * - step_start: sessionID, part.snapshot
 * - text: sessionID, part.text (assistant content)
 * - tool_use: sessionID, part.tool, part.state
 * - step_finish: sessionID, part.reason ("stop" | "tool-calls"), part.tokens
 *
 * Session ID is on every event (no separate session.created event).
 */
export function parseOpenCodeTranscript(jsonl: string): {
  text: string;
  sessionId?: string;
  error?: string;
} {
  let sessionId: string | undefined;
  const textParts: string[] = [];

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!sessionId && typeof event.sessionID === 'string') {
      sessionId = event.sessionID as string;
    }

    if (event.type === 'text') {
      const part = event.part as Record<string, unknown> | undefined;
      if (part?.text && typeof part.text === 'string') {
        textParts.push(part.text as string);
      }
    }
  }

  return { text: textParts.join('\n').trim(), sessionId };
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export class OpenCodeBackend implements Backend {
  readonly name = 'opencode';
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

  private getConfig(): { provider: string; pure: boolean } {
    const cfg = loadConfig();
    return {
      provider: (cfg.backends?.opencode?.provider as string | undefined) ?? 'ollama',
      pure: (cfg.backends?.opencode?.pure as boolean | undefined) ?? false,
    };
  }

  async run(opts: BackendRunOptions): Promise<string> {
    assertNotOpenCodeHost(opts.env);

    if (!isInPath('opencode')) {
      throw new OpenCodeBackendError(
        `opencode CLI not found in PATH. Install it: ${INSTALL_HINTS.opencode}`,
      );
    }

    const { provider, pure } = this.getConfig();
    // OpenCode has no native --schema enforcement — fall back to prompt
    // injection so callers asking for structured output (e.g.
    // --verdict-json) get a best-effort JSON-only response.
    const promptWithSchema = opts.schema
      ? injectSchemaPrompt(opts.prompt, opts.schema)
      : opts.prompt;
    const args = buildOpenCodeArgs({
      prompt: promptWithSchema,
      repoPath: opts.repoPath,
      model: opts.model,
      provider,
      fast: opts.fast || pure,
      sessionId: opts.sessionId ?? null,
      resumeSession: opts.resumeSession ?? false,
    });

    try {
      const result = await spawnCli('opencode', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: opts.repoPath,
        label: 'opencode',
      });

      const parsed = parseOpenCodeTranscript(result.stdout);

      if (parsed.sessionId && opts.onSessionCreated) {
        opts.onSessionCreated(parsed.sessionId);
      }

      if (parsed.error) {
        throw new OpenCodeBackendError(parsed.error);
      }

      if (!parsed.text) {
        throw new OpenCodeBackendError(OPENCODE_NO_OUTPUT_MESSAGE);
      }

      return parsed.text;
    } catch (err: unknown) {
      if (err instanceof OpenCodeBackendError) throw err;
      if (err instanceof BackendError) {
        throw new OpenCodeBackendError(err.message);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new OpenCodeBackendError(msg);
    }
  }

  async *runStream(opts: BackendRunOptions): AsyncGenerator<string> {
    assertNotOpenCodeHost(opts.env);

    if (!isInPath('opencode')) {
      throw new OpenCodeBackendError(
        `opencode CLI not found in PATH. Install it: ${INSTALL_HINTS.opencode}`,
      );
    }

    const { provider, pure } = this.getConfig();
    const args = buildOpenCodeArgs({
      prompt: opts.prompt,
      repoPath: opts.repoPath,
      model: opts.model,
      provider,
      fast: opts.fast || pure,
      sessionId: opts.sessionId ?? null,
      resumeSession: opts.resumeSession ?? false,
    });

    const child = spawn('opencode', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.repoPath,
      env: opts.env,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, opts.timeoutSeconds * 1000);

    const onSigint = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', onSigint);

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // OpenCode emits errors as JSON on stdout, not stderr. The parser hands
    // us the first such error via onError; we surface it on a non-zero exit
    // (or even a clean exit) so users see the real cause instead of a generic
    // "exited with code 1".
    let streamError: string | null = null;

    // The close handler only reports the raw exit status. The final error is
    // derived AFTER stdout is fully parsed, so streamError (parsed from stdout)
    // is available — building the message inside the handler would race past
    // the stdout error event and ignore it.
    const closePromise = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        child.on('close', (code, signal) => resolve({ code, signal: signal as string | null }));
      },
    );

    let chunkCount = 0;
    try {
      for await (const chunk of parseOpenCodeStreamJSON(
        child.stdout as Readable,
        {
          onSessionCreated: opts.onSessionCreated,
          onError: (msg) => { if (streamError === null) streamError = msg; },
        },
      )) {
        chunkCount++;
        yield chunk;
      }

      const { code, signal } = await closePromise;

      if (timedOut) {
        throw new OpenCodeBackendError(
          `opencode timed out after ${opts.timeoutSeconds}s`,
        );
      }
      if (signal) {
        throw new OpenCodeBackendError(`opencode killed by signal ${signal}`);
      }
      if (code !== 0 && code !== null) {
        const stderr = Buffer.concat(stderrChunks).toString().trim();
        throw new OpenCodeBackendError(
          stderr || streamError || `opencode exited with code ${code}`,
        );
      }
      // Clean exit. An error event on a clean exit must still surface, and
      // must be checked BEFORE the silent-output guard so it is not masked.
      if (streamError) {
        throw new OpenCodeBackendError(streamError);
      }
      // Zero text chunks on a clean exit: opencode emitted only
      // step_start/tool events — the silent-output case. Surface the same
      // error users see from the batch path.
      if (chunkCount === 0) {
        throw new OpenCodeBackendError(OPENCODE_NO_OUTPUT_MESSAGE);
      }
    } catch (err: unknown) {
      if (err instanceof OpenCodeBackendError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (timedOut) {
        throw new OpenCodeBackendError(
          `opencode timed out after ${opts.timeoutSeconds}s`,
        );
      }
      throw new OpenCodeBackendError(`opencode stream error: ${msg}`);
    } finally {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
  }

  async review(opts: ReviewOptions): Promise<string> {
    assertNotOpenCodeHost(opts.env);

    if (!isInPath('opencode')) {
      throw new OpenCodeBackendError(
        `opencode CLI not found in PATH. Install it: ${INSTALL_HINTS.opencode}`,
      );
    }

    const { provider } = this.getConfig();
    const prompt = opts.prompt
      ?? `Review the changes on this branch against ${opts.base}. Run git diff ${opts.base}...HEAD to see what changed.`;

    const args = buildOpenCodeArgs({
      prompt,
      repoPath: opts.repoPath,
      model: opts.model,
      provider,
      fast: false,
      sessionId: null,
      resumeSession: false,
    });

    try {
      const result = await spawnCli('opencode', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: opts.repoPath,
        label: 'opencode',
      });

      const parsed = parseOpenCodeTranscript(result.stdout);
      if (parsed.error) throw new OpenCodeBackendError(parsed.error);
      if (!parsed.text) {
        throw new OpenCodeBackendError(OPENCODE_REVIEW_NO_OUTPUT_MESSAGE);
      }
      return parsed.text;
    } catch (err: unknown) {
      if (err instanceof OpenCodeBackendError) throw err;
      if (err instanceof BackendError) {
        throw new OpenCodeBackendError(err.message);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new OpenCodeBackendError(msg);
    }
  }
}

function injectSchemaPrompt(prompt: string, schema: string): string {
  return `${prompt}\n\nRespond with JSON only. The response must match this JSON Schema exactly:\n${schema}`;
}

export const OPENCODE_BACKEND = new OpenCodeBackend();
registerBackend(OPENCODE_BACKEND);

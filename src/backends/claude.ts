/**
 * Claude Code CLI backend implementation.
 *
 * Subprocess backend using the `claude` CLI in print mode (`-p`).
 * Supports streaming via `--output-format stream-json` and session
 * persistence via `--session-id` / `-r` (planned for Phase 3).
 *
 * Sandbox is mapped to `--tools` + `--allowedTools` (tool policy, not OS sandbox).
 * Claude has no `-C` flag — use `cwd` in spawn/exec options instead.
 */

import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  type BackendCapabilities,
  type BackendRunOptions,
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  spawnCli,
  type Backend,
  type SandboxMode,
} from './index.js';
import { parseClaudeStreamJSON } from '../stream-parsers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const READ_ONLY_TOOLS = 'Read,Grep,Glob,LS,WebFetch,WebSearch';
const WORKSPACE_WRITE_TOOLS = 'Read,Grep,Glob,LS,Edit,Write,WebFetch,WebSearch';

/** Env vars that trigger Claude's nested-session guard. Strip before spawning. */
const NESTED_SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION'] as const;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ClaudeBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeBackendError';
  }
}

/**
 * Specialization of ClaudeBackendError for the "Not logged in" case.
 * Surfaces a clear remediation step so callers (skills, doctor, agents)
 * know exactly what the user needs to do.
 *
 * The remediation text is context-aware: when the relay is invoked from
 * inside Codex (PHONE_A_FRIEND_HOST=codex), the "Not logged in" error is
 * almost certainly Codex's workspace-write sandbox blocking subprocess
 * keychain access — NOT a genuine auth issue. Reproduce: a `claude -p`
 * subprocess that succeeds at the terminal will fail with "Not logged in"
 * when run inside `codex exec --sandbox workspace-write`. The fix is to
 * relax the sandbox, not to re-authenticate.
 */
export class ClaudeAuthError extends ClaudeBackendError {
  /** Human-readable remediation instruction. */
  readonly remediation: string;
  constructor(remediation?: string) {
    super('Claude CLI is not authenticated.');
    this.name = 'ClaudeAuthError';
    this.remediation = remediation ?? defaultClaudeRemediation();
  }
}

/**
 * Compose the right remediation string based on the calling host.
 * - From Codex: blame the sandbox first (the most common cause).
 * - From other hosts or unknown: blame the auth state.
 */
export function defaultClaudeRemediation(host: string = process.env.PHONE_A_FRIEND_HOST ?? ''): string {
  if (host === 'codex') {
    return (
      'Codex is running with a sandbox that blocks Claude\'s keychain access. ' +
      'Re-run Codex with `codex --sandbox danger-full-access` (or `--full-auto`), ' +
      'or escalate this specific command via the approval prompt. ' +
      'This is NOT a Claude login problem — `claude -p` works fine outside the Codex sandbox.'
    );
  }
  return 'Run `claude` interactively, then `/login` to authenticate. Or export ANTHROPIC_API_KEY.';
}

/**
 * Detect the well-known "Not logged in" stderr / stdout markers Claude CLI
 * emits when no OAuth session is available. Used to convert raw subprocess
 * errors into a structured auth error.
 */
export function isClaudeAuthError(msg: string): boolean {
  // Claude CLI prints variations like:
  //   "Not logged in · Please run /login"
  //   "Please run /login"
  //   "You are not logged in."
  const text = msg.toLowerCase();
  return text.includes('not logged in') || text.includes('please run /login');
}

/**
 * Extract the schema payload from Claude's `--output-format json` envelope.
 *
 * With `--json-schema`, Claude Code returns the full result envelope
 * (`{type, subtype, result, structured_output, ...}`) on stdout, and the
 * schema-conforming value lives under `.structured_output`. Returning the raw
 * envelope leaks the wrapper to callers (e.g. `jq '.ok'` yields null) and is
 * inconsistent with the Codex backend, which returns the clean value.
 *
 * We extract `.structured_output` whenever the parsed envelope owns that key,
 * serializing whatever value it holds — JSON Schema roots can be objects,
 * arrays, strings, numbers, booleans, or null, so we must NOT restrict to
 * object values. If the envelope can't be parsed or has no `structured_output`
 * key, we fall back to the raw stdout rather than swallowing output.
 *
 * Only used in schema mode; plain-text runs return stdout verbatim.
 */
export function extractClaudeSchemaOutput(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return stdout;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.prototype.hasOwnProperty.call(parsed, 'structured_output')
  ) {
    return JSON.stringify((parsed as Record<string, unknown>).structured_output);
  }
  return stdout;
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export class ClaudeBackend implements Backend {
  readonly name = 'claude';
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

  /**
   * Strip env vars that trigger Claude's nested-session guard.
   * Without this, spawning claude from inside a Claude Code session fails with:
   * "Claude Code cannot be launched inside another Claude Code session."
   */
  private cleanEnv(env: Record<string, string>): Record<string, string> {
    const cleaned = { ...env };
    for (const key of NESTED_SESSION_VARS) {
      delete cleaned[key];
    }
    return cleaned;
  }

  /**
   * Build the common CLI args shared by run() and runStream().
   */
  private buildArgs(opts: {
    prompt: string;
    repoPath: string;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
    outputFormat?: string;
    schema?: string | null;
    fast?: boolean;
    sessionId?: string | null;
    resumeSession?: boolean;
  }): string[] {
    const args: string[] = ['-p', opts.prompt];

    if (opts.sessionId) {
      if (opts.resumeSession) {
        args.push('-r', opts.sessionId);
      } else {
        args.push('--session-id', opts.sessionId);
      }
    }

    // Repo access
    if (!opts.resumeSession) {
      args.push('--add-dir', opts.repoPath);
    }

    // Output format
    if (opts.schema) {
      args.push('--output-format', 'json', '--json-schema', opts.schema);
    } else if (opts.outputFormat) {
      args.push('--output-format', opts.outputFormat);
    }

    // Model
    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Max turns (from env or default)
    const maxTurns = opts.env.CLAUDE_MAX_TURNS ?? '10';
    args.push('--max-turns', maxTurns);

    // Max budget (from env, optional)
    const maxBudget = opts.env.CLAUDE_MAX_BUDGET;
    if (maxBudget) {
      args.push('--max-budget-usd', maxBudget);
    }

    // Sandbox → tool policy
    if (opts.sandbox === 'danger-full-access') {
      args.push('--dangerously-skip-permissions');
    } else {
      const tools = opts.sandbox === 'read-only'
        ? READ_ONLY_TOOLS
        : WORKSPACE_WRITE_TOOLS;
      args.push('--tools', tools);
      args.push('--allowedTools', tools);
    }

    // Depth guard: prevent recursion via skills and subagents
    args.push('--disable-slash-commands');
    args.push('--disallowedTools', 'Task');

    // Intentionally ignore opts.fast for Claude. `--bare` skips OAuth/keychain
    // reads and breaks subscription auth; API-key users may be fine, but PaF
    // cannot reliably detect that auth mode.

    // Ephemeral by default (print mode persists sessions otherwise)
    if (!opts.sessionId) {
      args.push('--no-session-persistence');
    }

    return args;
  }

  async run(opts: BackendRunOptions): Promise<string> {
    if (!isInPath('claude')) {
      throw new ClaudeBackendError(
        `claude CLI not found in PATH. Install it: ${INSTALL_HINTS.claude}`,
      );
    }

    const args = this.buildArgs({
      ...opts,
      outputFormat: opts.schema ? undefined : 'text',
    });

    try {
      const result = await spawnCli('claude', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: this.cleanEnv(opts.env),
        cwd: opts.repoPath,
        label: 'claude',
      });

      if (result.stdout) {
        return opts.schema
          ? extractClaudeSchemaOutput(result.stdout)
          : result.stdout;
      }

      throw new ClaudeBackendError('claude completed without producing output');
    } catch (err: unknown) {
      if (err instanceof ClaudeBackendError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (isClaudeAuthError(msg)) {
        throw new ClaudeAuthError();
      }
      if (err instanceof BackendError) {
        throw new ClaudeBackendError(err.message);
      }
      throw new ClaudeBackendError(msg);
    }
  }

  async *runStream(opts: BackendRunOptions): AsyncGenerator<string> {
    if (!isInPath('claude')) {
      throw new ClaudeBackendError(
        `claude CLI not found in PATH. Install it: ${INSTALL_HINTS.claude}`,
      );
    }

    const args = this.buildArgs({
      ...opts,
      outputFormat: 'stream-json',
    });

    // --output-format stream-json requires --verbose in print mode
    args.push('--verbose');
    // Add --include-partial-messages for incremental streaming
    args.push('--include-partial-messages');

    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.repoPath,
      env: this.cleanEnv(opts.env),
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, opts.timeoutSeconds * 1000);

    // Forward SIGINT to the child so Ctrl+C kills the subprocess
    const onSigint = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', onSigint);

    // Drain stderr to prevent pipe backpressure stalling the child
    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // Register close handler BEFORE consuming stdout to avoid missing the event
    const closePromise = new Promise<void>((resolve, reject) => {
      child.on('close', (code, signal) => {
        if (timedOut) {
          reject(new ClaudeBackendError(
            `claude timed out after ${opts.timeoutSeconds}s`,
          ));
        } else if (signal) {
          reject(new ClaudeBackendError(
            `claude killed by signal ${signal}`,
          ));
        } else if (code !== 0 && code !== null) {
          const stderr = Buffer.concat(stderrChunks).toString().trim();
          const errMsg = stderr || `claude exited with code ${code}`;
          if (isClaudeAuthError(errMsg)) {
            reject(new ClaudeAuthError());
          } else {
            reject(new ClaudeBackendError(errMsg));
          }
        } else {
          resolve();
        }
      });
    });

    try {
      yield* parseClaudeStreamJSON(child.stdout as Readable);
      // Parser succeeded — verify process exited cleanly
      await closePromise;
    } catch (err: unknown) {
      // Suppress the close promise rejection since we already have an error
      closePromise.catch(() => {});

      if (err instanceof ClaudeBackendError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (timedOut) {
        throw new ClaudeBackendError(
          `claude timed out after ${opts.timeoutSeconds}s`,
        );
      }
      throw new ClaudeBackendError(`claude stream error: ${msg}`);
    } finally {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
  }
}

export const CLAUDE_BACKEND = new ClaudeBackend();
registerBackend(CLAUDE_BACKEND);

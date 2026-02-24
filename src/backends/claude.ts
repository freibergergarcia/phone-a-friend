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

import { execFileSync, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
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
  }): string[] {
    const args: string[] = ['-p', opts.prompt];

    // Repo access
    args.push('--add-dir', opts.repoPath);

    // Output format
    if (opts.outputFormat) {
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

    // Ephemeral by default (print mode persists sessions otherwise)
    args.push('--no-session-persistence');

    return args;
  }

  async run(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): Promise<string> {
    if (!isInPath('claude')) {
      throw new ClaudeBackendError(
        `claude CLI not found in PATH. Install it: ${INSTALL_HINTS.claude}`,
      );
    }

    const args = this.buildArgs({
      ...opts,
      outputFormat: 'text',
    });

    try {
      const result = execFileSync('claude', args, {
        timeout: opts.timeoutSeconds * 1000,
        env: this.cleanEnv(opts.env),
        encoding: 'utf-8',
        cwd: opts.repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const output = result.trim();
      if (output) {
        return output;
      }

      throw new ClaudeBackendError('claude completed without producing output');
    } catch (err: unknown) {
      if (err instanceof ClaudeBackendError) throw err;

      const execErr = err as NodeJS.ErrnoException & {
        status?: number;
        stdout?: Buffer | string;
        stderr?: Buffer | string;
        killed?: boolean;
        signal?: string;
      };

      // Timeout detection
      if (execErr.killed || execErr.signal === 'SIGTERM' || execErr.code === 'ETIMEDOUT') {
        throw new ClaudeBackendError(
          `claude timed out after ${opts.timeoutSeconds}s`,
        );
      }

      // Non-zero exit code
      const stderr = execErr.stderr?.toString().trim() ?? '';
      const stdout = execErr.stdout?.toString().trim() ?? '';
      const detail = stderr || stdout || `claude exited with code ${execErr.status ?? 1}`;
      throw new ClaudeBackendError(detail);
    }
  }

  async *runStream(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): AsyncGenerator<string> {
    if (!isInPath('claude')) {
      throw new ClaudeBackendError(
        `claude CLI not found in PATH. Install it: ${INSTALL_HINTS.claude}`,
      );
    }

    const args = this.buildArgs({
      ...opts,
      outputFormat: 'stream-json',
    });

    // Add --include-partial-messages for incremental streaming
    args.push('--include-partial-messages');

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.repoPath,
      env: this.cleanEnv(opts.env),
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, opts.timeoutSeconds * 1000);

    try {
      yield* parseClaudeStreamJSON(child.stdout as Readable);
    } catch (err: unknown) {
      if (err instanceof ClaudeBackendError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timed out') || msg.includes('SIGTERM')) {
        throw new ClaudeBackendError(
          `claude timed out after ${opts.timeoutSeconds}s`,
        );
      }
      throw new ClaudeBackendError(`claude stream error: ${msg}`);
    } finally {
      clearTimeout(timer);
      // Ensure child is cleaned up
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }

    // Check exit code
    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new ClaudeBackendError(`claude exited with code ${code}`));
        } else {
          resolve();
        }
      });
      // If already exited
      if (child.exitCode !== null) {
        if (child.exitCode !== 0) {
          reject(new ClaudeBackendError(`claude exited with code ${child.exitCode}`));
        } else {
          resolve();
        }
      }
    });
  }
}

export const CLAUDE_BACKEND = new ClaudeBackend();
registerBackend(CLAUDE_BACKEND);

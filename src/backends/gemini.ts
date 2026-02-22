/**
 * Gemini backend implementation.
 *
 * Ported from phone_a_friend/backends/gemini.py
 *
 * The Gemini CLI uses a different interface from Codex:
 * - Non-interactive mode: gemini --prompt "<prompt>"
 * - Repo context: --include-directories <dir> (cwd also set)
 * - Sandbox: --sandbox (boolean flag — on for read-only/workspace-write, off for full access)
 * - Output: captured from stdout (--output-format text)
 * - Model: -m <model>
 * - Auto-approve: --yolo enables tool use in headless mode
 */

import { execFileSync } from 'node:child_process';
import {
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  type Backend,
  type SandboxMode,
} from './index.js';

export class GeminiBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiBackendError';
  }
}

export class GeminiBackend implements Backend {
  readonly name = 'gemini';
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);

  run(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): string {
    if (!isInPath('gemini')) {
      throw new GeminiBackendError(
        `gemini CLI not found in PATH. Install it: ${INSTALL_HINTS.gemini}`,
      );
    }

    const args: string[] = [];

    // Sandbox is boolean: on for read-only/workspace-write, off for full access
    if (opts.sandbox !== 'danger-full-access') {
      args.push('--sandbox');
    }

    // Auto-approve tool actions in headless mode (--sandbox constrains scope)
    args.push('--yolo');
    args.push('--include-directories', opts.repoPath);
    args.push('--output-format', 'text');

    if (opts.model) {
      args.push('-m', opts.model);
    }

    args.push('--prompt', opts.prompt);

    try {
      const result = execFileSync('gemini', args, {
        timeout: opts.timeoutSeconds * 1000,
        env: opts.env,
        encoding: 'utf-8',
        cwd: opts.repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const output = (typeof result === 'string' ? result : result?.toString() ?? '').trim();
      if (output) {
        return output;
      }

      throw new GeminiBackendError('gemini completed without producing output');
    } catch (err: unknown) {
      // Re-throw our own errors
      if (err instanceof GeminiBackendError) throw err;

      const execErr = err as NodeJS.ErrnoException & {
        status?: number;
        stdout?: Buffer | string;
        stderr?: Buffer | string;
        killed?: boolean;
        signal?: string;
      };

      // Timeout detection
      if (execErr.killed || execErr.signal === 'SIGTERM' || execErr.code === 'ETIMEDOUT') {
        throw new GeminiBackendError(
          `gemini timed out after ${opts.timeoutSeconds}s`,
        );
      }

      // Non-zero exit code
      const stderr = execErr.stderr?.toString().trim() ?? '';
      const stdout = execErr.stdout?.toString().trim() ?? '';
      const detail = stderr || stdout || `gemini exited with code ${execErr.status ?? 1}`;
      throw new GeminiBackendError(detail);
    }
  }
}

export const GEMINI_BACKEND = new GeminiBackend();
registerBackend(GEMINI_BACKEND);

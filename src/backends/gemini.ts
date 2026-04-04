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

import {
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  spawnCli,
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
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);

  async run(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): Promise<string> {
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
      const result = await spawnCli('gemini', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: opts.repoPath,
        label: 'gemini',
      });

      if (!result.stdout) {
        throw new GeminiBackendError('gemini completed without producing output');
      }

      return result.stdout;
    } catch (err: unknown) {
      if (err instanceof GeminiBackendError) throw err;
      if (err instanceof BackendError) {
        throw new GeminiBackendError(err.message);
      }
      throw err;
    }
  }
}

export const GEMINI_BACKEND = new GeminiBackend();
registerBackend(GEMINI_BACKEND);

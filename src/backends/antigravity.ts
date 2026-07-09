/**
 * Google Antigravity CLI backend implementation.
 *
 * Antigravity is not a Gemini CLI drop-in replacement. The user-facing
 * backend is named `antigravity`, while the executable is `agy`.
 *
 * Phase 1 intentionally supports read-only, one-shot relay/review only. The
 * local `agy` CLI exposes conversation flags, write modes, and permission
 * bypasses, but PaF should not promise sessions or write support until those
 * surfaces are proven in non-interactive print mode.
 */

import {
  type BackendCapabilities,
  type BackendRunOptions,
  BACKEND_COMMANDS,
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  SpawnCliError,
  spawnCli,
  SpawnCliTimeoutError,
  type Backend,
  type SandboxMode,
} from './index.js';

const ANTIGRAVITY_COMMAND = BACKEND_COMMANDS.antigravity ?? 'agy';
const OUTER_TIMEOUT_GRACE_SECONDS = 15;

export class AntigravityBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityBackendError';
  }
}

export function antigravityTimeoutRemediation(host: string): string {
  if (host === 'codex') {
    return (
      'Antigravity timed out under Codex\'s sandbox. Codex\'s default workspace-write ' +
      'sandbox can block subprocess OAuth/keychain access and outbound Google auth refresh. ' +
      'Re-run Codex with `codex --sandbox danger-full-access` (or `--full-auto`), ' +
      'or run the relay from a regular terminal.'
    );
  }
  return (
    'Antigravity timed out. Verify `agy --prompt "test"` works at the terminal ' +
    'and that your Google account is authenticated.'
  );
}

export class AntigravityBackend implements Backend {
  readonly name = 'antigravity';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
  ]);
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'unsupported',
    requiresClientSessionId: false,
  };

  async run(opts: BackendRunOptions): Promise<string> {
    if (!isInPath(ANTIGRAVITY_COMMAND, opts.env)) {
      throw new AntigravityBackendError(
        `Antigravity CLI not found in PATH. Install it: ${INSTALL_HINTS.antigravity}`,
      );
    }

    const prompt = opts.schema
      ? injectSchemaPrompt(opts.prompt, opts.schema)
      : opts.prompt;

    const args = buildAntigravityArgs({
      prompt,
      repoPath: opts.repoPath,
      sandbox: opts.sandbox,
      model: opts.model,
      timeoutSeconds: opts.timeoutSeconds,
    });

    try {
      const result = await spawnCli(ANTIGRAVITY_COMMAND, args, {
        timeoutMs: (opts.timeoutSeconds + OUTER_TIMEOUT_GRACE_SECONDS) * 1000,
        env: opts.env,
        cwd: opts.repoPath,
        label: 'antigravity',
      });

      if (!result.stdout) {
        throw new AntigravityBackendError('antigravity completed without producing output');
      }

      return result.stdout;
    } catch (err) {
      if (err instanceof AntigravityBackendError) throw err;
      if (err instanceof SpawnCliTimeoutError) {
        throw new AntigravityBackendError(
          `${err.message}. ${antigravityTimeoutRemediation(opts.env.PHONE_A_FRIEND_HOST ?? '')}`,
        );
      }
      if (err instanceof SpawnCliError) {
        throw new AntigravityBackendError(formatAntigravitySpawnError(err));
      }
      if (err instanceof BackendError) {
        throw new AntigravityBackendError(err.message);
      }
      throw err;
    }
  }
}

interface AntigravityArgsOptions {
  prompt: string;
  repoPath: string;
  sandbox: SandboxMode;
  model: string | null;
  timeoutSeconds: number;
}

export function buildAntigravityArgs(opts: AntigravityArgsOptions): string[] {
  switch (opts.sandbox) {
    case 'read-only':
      break;
    case 'workspace-write':
    case 'danger-full-access':
      throw new AntigravityBackendError(
        `Antigravity backend currently supports read-only sandbox only, got: ${opts.sandbox}`,
      );
    default: {
      const exhaustive: never = opts.sandbox;
      throw new AntigravityBackendError(`Unsupported Antigravity sandbox: ${exhaustive}`);
    }
  }

  const args = [
    '--add-dir',
    opts.repoPath,
    '--print-timeout',
    `${opts.timeoutSeconds}s`,
    '--sandbox',
    '--mode',
    'plan',
  ];

  if (opts.model) {
    args.push('--model', opts.model);
  }

  args.push('--prompt', opts.prompt);
  return args;
}

function injectSchemaPrompt(prompt: string, schema: string): string {
  return `${prompt}\n\nRespond with JSON only. The response must match this JSON Schema exactly:\n${schema}`;
}

function formatAntigravitySpawnError(err: SpawnCliError): string {
  const lines = [`Antigravity exited with code ${err.exitCode ?? 'unknown'}.`];
  if (err.stderr) lines.push(`stderr: ${err.stderr}`);
  if (err.stdout) lines.push(`stdout: ${err.stdout}`);
  if (!err.stderr && !err.stdout) lines.push(err.message);
  return lines.join('\n');
}

export const ANTIGRAVITY_BACKEND = new AntigravityBackend();
registerBackend(ANTIGRAVITY_BACKEND);

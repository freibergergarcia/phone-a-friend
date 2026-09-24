/**
 * Google Antigravity CLI backend implementation.
 *
 * Antigravity is not a Gemini CLI drop-in replacement. The user-facing
 * backend is named `antigravity`, while the executable is `agy`.
 *
 * Supports read-only relay/review with native conversation resume.
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
    resumeStrategy: 'native-session',
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
      persistSession: opts.persistSession,
      resumeSession: opts.resumeSession,
      sessionId: opts.sessionId,
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

      if (opts.persistSession || opts.resumeSession) {
        let payload;
        try {
          payload = JSON.parse(result.stdout);
        } catch {
          throw new AntigravityBackendError('Antigravity returned invalid session JSON');
        }
        if (payload?.status !== 'SUCCESS') {
          const detail = typeof payload?.response === 'string' ? payload.response.trim() : '';
          throw new AntigravityBackendError(
            `Antigravity session failed with status: ${payload?.status ?? 'missing'}` +
              (detail ? `: ${detail}` : ''),
          );
        }
        if (typeof payload.response !== 'string' || !payload.response.trim()) {
          throw new AntigravityBackendError('Antigravity session completed without producing a response');
        }
        if (typeof payload.conversation_id === 'string' && payload.conversation_id.trim()) {
          opts.onSessionCreated?.(payload.conversation_id);
        }
        return payload.response;
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
  persistSession?: boolean;
  resumeSession?: boolean;
  sessionId?: string | null;
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

  if (opts.persistSession || opts.resumeSession) {
    args.push('--output-format', 'json');
  }
  if (opts.resumeSession && opts.sessionId) {
    args.push('--conversation', opts.sessionId);
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

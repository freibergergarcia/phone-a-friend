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
  type BackendCapabilities,
  type BackendRunOptions,
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  SpawnCliError,
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
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'transcript-replay',
    requiresClientSessionId: false,
  };

  async run(opts: BackendRunOptions): Promise<string> {
    if (!isInPath('gemini')) {
      throw new GeminiBackendError(
        `gemini CLI not found in PATH. Install it: ${INSTALL_HINTS.gemini}`,
      );
    }

    const args: string[] = [];
    const useJsonOutput = Boolean(opts.schema);
    const prompt = opts.schema
      ? injectSchemaPrompt(opts.prompt, opts.schema)
      : opts.prompt;

    // Sandbox is boolean: on for read-only/workspace-write, off for full access
    if (opts.sandbox !== 'danger-full-access') {
      args.push('--sandbox');
    }

    // Auto-approve tool actions in headless mode (--sandbox constrains scope)
    args.push('--yolo');
    args.push('--include-directories', opts.repoPath);
    args.push('--output-format', useJsonOutput ? 'json' : 'text');

    if (opts.resumeSession && opts.sessionId) {
      args.push('--resume', opts.sessionId);
    }

    if (opts.model) {
      args.push('-m', opts.model);
    }

    args.push('--prompt', prompt);

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

      if (useJsonOutput) {
        maybeEmitGeminiSessionId(result.stdout, opts.onSessionCreated);
        return extractGeminiResult(result.stdout);
      }

      return result.stdout;
    } catch (err: unknown) {
      if (err instanceof SpawnCliError && err.exitCode === 53) {
        if (err.stdout) {
          try {
            maybeEmitGeminiSessionId(err.stdout, opts.onSessionCreated);
            return useJsonOutput ? extractGeminiResult(err.stdout) : err.stdout;
          } catch {
            throw new GeminiBackendError('Gemini reached turn limit, response may be incomplete');
          }
        }
        throw new GeminiBackendError('Gemini reached turn limit, response may be incomplete');
      }
      if (err instanceof GeminiBackendError) throw err;
      if (err instanceof BackendError) {
        throw new GeminiBackendError(err.message);
      }
      throw err;
    }
  }
}

function injectSchemaPrompt(prompt: string, schema: string): string {
  return `${prompt}\n\nRespond with JSON only. The response must match this JSON Schema exactly:\n${schema}`;
}

function maybeEmitGeminiSessionId(
  jsonOutput: string,
  onSessionCreated?: (sessionId: string) => void,
): void {
  const sessionId = extractGeminiSessionId(jsonOutput);
  if (sessionId && onSessionCreated) {
    onSessionCreated(sessionId);
  }
}

/**
 * Best-effort session ID extraction from Gemini JSON output.
 * The exact field name is unverified against live Gemini CLI output.
 * If no session ID is found, session resume for Gemini will silently
 * not work (new session each time). This is acceptable until the
 * Gemini CLI's JSON output format is confirmed.
 */
function extractGeminiSessionId(jsonOutput: string): string | undefined {
  try {
    const result = JSON.parse(jsonOutput) as Record<string, unknown>;
    if (typeof result.sessionId === 'string') return result.sessionId;
    if (typeof result.session_id === 'string') return result.session_id;
    const stats = result.stats;
    if (stats && typeof stats === 'object') {
      const statsRecord = stats as Record<string, unknown>;
      if (typeof statsRecord.sessionId === 'string') return statsRecord.sessionId;
      if (typeof statsRecord.session_id === 'string') return statsRecord.session_id;
    }
  } catch {
    // Ignore parse failures; extractGeminiResult will surface them later if needed.
  }
  return undefined;
}

export function extractGeminiResult(jsonOutput: string): string {
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(jsonOutput) as Record<string, unknown>;
  } catch (err) {
    throw new GeminiBackendError(`gemini returned invalid JSON output: ${err}`);
  }

  if (result.error) {
    throw new GeminiBackendError(String(result.error));
  }

  if (typeof result.response !== 'string') {
    throw new GeminiBackendError('gemini JSON output did not include a response field');
  }

  return result.response;
}

export const GEMINI_BACKEND = new GeminiBackend();
registerBackend(GEMINI_BACKEND);

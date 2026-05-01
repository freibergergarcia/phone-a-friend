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
import {
  buildAttemptChain,
  classifyGeminiError,
  GeminiModelCache,
  isAutoFallbackDisabled,
} from '../gemini-models.js';

export class GeminiBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiBackendError';
  }
}

interface AttemptFailure {
  model: string;
  kind: ReturnType<typeof classifyGeminiError>['kind'];
  message: string;
}

export class GeminiBackend implements Backend {
  readonly name = 'gemini';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);
  // Session resume is declared 'unsupported' rather than 'transcript-replay':
  // run() never reads opts.sessionHistory, and the --resume code path below
  // depends on a session ID that the upstream extractor cannot reliably
  // produce (see extractGeminiSessionId). Until the Gemini CLI's session
  // surface is verified, --session against this backend is rejected at the
  // relay layer instead of silently no-opping.
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'unsupported',
    requiresClientSessionId: false,
  };

  async run(opts: BackendRunOptions): Promise<string> {
    if (!isInPath('gemini')) {
      throw new GeminiBackendError(
        `gemini CLI not found in PATH. Install it: ${INSTALL_HINTS.gemini}`,
      );
    }

    const envForOpts = (opts.env && Object.keys(opts.env).length > 0
      ? opts.env
      : process.env) as NodeJS.ProcessEnv;

    const fallbackEligible =
      Boolean(opts.model) &&
      !opts.resumeSession &&
      !isAutoFallbackDisabled(envForOpts);

    if (!fallbackEligible) {
      return this.runOnce(opts, opts.model ?? null, false);
    }

    const cache = new GeminiModelCache();
    cache.prune();
    const requestedModel = opts.model as string;
    const chain = buildAttemptChain(requestedModel, cache.load());
    if (chain.length === 0) {
      throw new GeminiBackendError(
        `All known Gemini models are cached as unavailable. Run 'phone-a-friend doctor' or wait for the 24h cache to expire.`,
      );
    }

    // If the cache filtered the user's requested model out of the chain,
    // surface that explicitly. They asked for X and they're getting Y; they
    // should know without having to inspect the cache file.
    if (chain[0] !== requestedModel) {
      process.stderr.write(
        `[phone-a-friend] Gemini model ${requestedModel} is cached as unavailable; using ${chain[0]}. ` +
          `Set PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK=false or wait 24h for the cache to expire.\n`,
      );
    }

    const failures: AttemptFailure[] = [];
    const overallStart = Date.now();
    const overallBudgetMs = opts.timeoutSeconds * 1000;

    for (let i = 0; i < chain.length; i++) {
      const candidate = chain[i];
      const elapsed = Date.now() - overallStart;
      const remaining = overallBudgetMs - elapsed;

      // Strict deadline: do not start a new attempt past the budget.
      if (remaining <= 0) {
        failures.push({
          model: candidate,
          kind: 'other',
          message: 'shared deadline exhausted before attempt',
        });
        break;
      }

      const remainingSeconds = Math.max(1, Math.ceil(remaining / 1000));

      try {
        return await this.runOnce(
          { ...opts, timeoutSeconds: remainingSeconds },
          candidate,
          true,
        );
      } catch (err) {
        const cls = classifyGeminiAttemptError(err);
        failures.push({
          model: candidate,
          kind: cls.kind,
          message: cls.message,
        });

        if (cls.kind === 'model-not-found') {
          if (cls.cacheable) {
            // Cache write failures are non-fatal: the cache is an optimization,
            // not a correctness primitive. Keep falling back even if disk fails.
            try {
              cache.markDead(candidate, {
                httpStatus: cls.httpStatus ?? 404,
                message: cls.message,
                source: 'relay-failure',
              });
            } catch (cacheErr) {
              process.stderr.write(
                `[phone-a-friend] Failed to persist Gemini model cache: ${(cacheErr as Error).message}\n`,
              );
            }
          }
          if (i < chain.length - 1) {
            const cachedSuffix = cls.cacheable ? ' Cached for 24h.' : '';
            process.stderr.write(
              `[phone-a-friend] Gemini model ${candidate} is unavailable (404); falling back to ${chain[i + 1]}.${cachedSuffix}\n`,
            );
          }
          continue;
        }

        if (cls.kind === 'rate-limit') {
          if (i < chain.length - 1) {
            process.stderr.write(
              `[phone-a-friend] Gemini model ${candidate} hit a rate-limit / capacity error; falling back to ${chain[i + 1]} (not cached, transient).\n`,
            );
          }
          continue;
        }

        // Auth or other: fallback won't help. Surface immediately.
        if (err instanceof GeminiBackendError) throw err;
        if (err instanceof BackendError) {
          throw new GeminiBackendError(err.message);
        }
        throw err;
      }
    }

    const summary = failures
      .map((f) => `  - ${f.model}: ${f.kind} (${f.message})`)
      .join('\n');
    throw new GeminiBackendError(
      `Gemini auto-fallback exhausted after ${failures.length} attempt(s):\n${summary}\n` +
        `Set PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK=false to disable fallback and surface the original error.`,
    );
  }

  private async runOnce(
    opts: BackendRunOptions,
    model: string | null,
    fromFallbackChain: boolean,
  ): Promise<string> {
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

    if (model) {
      args.push('-m', model);
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
      // When called from the fallback chain, propagate the raw error so the
      // caller can classify it. Otherwise preserve legacy single-shot behavior:
      // wrap BackendError as GeminiBackendError, rethrow GeminiBackendError as-is.
      if (fromFallbackChain) throw err;
      if (err instanceof GeminiBackendError) throw err;
      if (err instanceof BackendError) {
        throw new GeminiBackendError(err.message);
      }
      throw err;
    }
  }
}

function classifyGeminiAttemptError(err: unknown): ReturnType<typeof classifyGeminiError> {
  if (err instanceof SpawnCliError) {
    return classifyGeminiError({
      exitCode: err.exitCode ?? undefined,
      stderr: err.stderr,
      stdout: err.stdout,
      message: err.message,
    });
  }
  if (err instanceof GeminiBackendError) {
    return classifyGeminiError({ message: err.message });
  }
  if (err instanceof Error) {
    return classifyGeminiError({ message: err.message });
  }
  return classifyGeminiError({ message: String(err) });
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

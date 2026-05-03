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
  classifyGeminiError,
  type DeadModelEntry,
  GeminiModelCache,
  isDeadCacheDisabled,
} from '../gemini-models.js';

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

    // Cache is consulted only when the caller pinned a specific model. For
    // unset --model we let gemini-cli's own auto-routing pick, and we never
    // cache results from the auto-routed path. Session resume is also
    // exempt because the cache is keyed by model name.
    const cacheEligible =
      Boolean(opts.model) &&
      !opts.resumeSession &&
      !isDeadCacheDisabled(envForOpts);

    let cache: GeminiModelCache | null = null;
    if (cacheEligible) {
      cache = new GeminiModelCache();
      cache.prune();
      const requestedModel = opts.model as string;
      const deadEntry = cache.getDeadEntry(requestedModel);
      if (deadEntry) {
        // Fail fast: previously cached as dead. No spawn, no slow 404
        // round-trip. Caller decides how to proceed.
        throw new GeminiBackendError(
          formatDeadModelError(requestedModel, deadEntry, cache.getCachePath()),
        );
      }
    }

    try {
      return await this.runOnce(opts, opts.model ?? null);
    } catch (err) {
      // On a strong ModelNotFoundError, persist the dead-model entry so
      // subsequent calls fail fast. Do NOT cache ambiguous 404s, rate
      // limits, auth failures, or any other error class — those either
      // resolve themselves (transient) or aren't model-bound (project /
      // file 404s, auth scope issues).
      if (cacheEligible && cache) {
        const cls = classifyAttemptError(err);
        if (cls.kind === 'model-not-found' && cls.cacheable) {
          const requestedModel = opts.model as string;
          try {
            cache.markDead(requestedModel, {
              httpStatus: cls.httpStatus ?? 404,
              message: cls.message,
              source: 'relay-failure',
            });
            // Re-read the entry we just wrote so the error message
            // includes the same fields the cache-hit path would surface.
            const writtenEntry = cache.getDeadEntry(requestedModel);
            if (writtenEntry) {
              throw new GeminiBackendError(
                formatDeadModelError(
                  requestedModel,
                  writtenEntry,
                  cache.getCachePath(),
                ),
              );
            }
          } catch (cacheErr) {
            // Cache write failures are non-fatal: the cache is an
            // optimization, not a correctness primitive. Surface a
            // best-effort error that still includes bypass instructions
            // even if we couldn't persist.
            if (cacheErr instanceof GeminiBackendError) throw cacheErr;
            process.stderr.write(
              `[phone-a-friend] Failed to persist Gemini model cache: ${(cacheErr as Error).message}\n`,
            );
            throw new GeminiBackendError(
              `Model \`${requestedModel}\` returned 404 from Gemini (ModelNotFoundError). ` +
                `Cache could not be persisted at ${cache.getCachePath()}. ` +
                `Run without \`--model\` to use Gemini's auto-routing, or set ` +
                `\`PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false\` to skip the cache check.`,
            );
          }
        }
      }
      if (err instanceof GeminiBackendError) throw err;
      if (err instanceof BackendError) {
        throw new GeminiBackendError(err.message);
      }
      throw err;
    }
  }

  private async runOnce(
    opts: BackendRunOptions,
    model: string | null,
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
      // Re-throw raw so run() can classify and decide whether to cache.
      throw err;
    }
  }
}

/**
 * Format the cache-aware error message used on both the strong-404 first-hit
 * path and the fail-fast cache-hit path. Includes the cache file location,
 * expiry timestamp, and bypass instructions, but never recommends specific
 * fallback model names — that's the staleness vector this redesign avoids.
 */
function formatDeadModelError(
  model: string,
  entry: DeadModelEntry,
  cachePath: string,
): string {
  return (
    `Model \`${model}\` returned 404 from Gemini (ModelNotFoundError). ` +
    `Cached as unavailable until ${entry.expiresAt} at ${cachePath}. ` +
    `Run without \`--model\` to use Gemini's auto-routing, ` +
    `set \`PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false\` to bypass the cache, ` +
    `or delete the cache file to clear it.`
  );
}

function classifyAttemptError(err: unknown): ReturnType<typeof classifyGeminiError> {
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

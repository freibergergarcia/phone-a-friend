/**
 * Gemini model availability cache.
 *
 * Tracks Gemini models that returned model-not-found (404) so the backend
 * can skip them on subsequent calls without paying the round-trip cost.
 *
 * Stored at ~/.config/phone-a-friend/gemini-models.json (XDG_CONFIG_HOME aware).
 *
 * Only deterministic unavailability is cached. Transient errors (rate-limits,
 * 5xx) are surfaced as retry-without-caching by the classifier and never
 * persist a "dead" entry — those errors come and go with capacity, and
 * caching them would falsely deny a working model after a momentary spike.
 *
 * NOT parallel-write safe (same caveat as src/sessions.ts).
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const CACHE_SCHEMA_VERSION = 1;

export const DEAD_MODEL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Documented Gemini fallback chain, in priority order.
 *
 * Preview / capacity-flaky models are deliberately omitted: they belong in
 * skill docs as discovery aids, not in the auto-fallback path. Adding them
 * here would just waste a round-trip on every relay.
 */
export const GEMINI_FALLBACK_CHAIN: readonly string[] = Object.freeze([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export type GeminiErrorKind =
  | 'model-not-found'
  | 'rate-limit'
  | 'auth'
  | 'other';

export interface GeminiErrorClassification {
  kind: GeminiErrorKind;
  message: string;
  httpStatus?: number;
  /**
   * True only when the error has a strong signal that the failure is bound
   * to the model itself (e.g. gemini's own `ModelNotFoundError` classifier).
   * Ambiguous 404s ("Requested entity was not found.") without a model marker
   * are treated as `model-not-found` for fallback purposes but are not
   * cached — caching a 404 caused by, say, a missing project would poison a
   * working model for 24h.
   */
  cacheable?: boolean;
}

export interface DeadModelEntry {
  status: 'unavailable';
  reason: 'not_found';
  httpStatus: number;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string;
  source: string;
  message: string;
}

export interface DeadModelCache {
  schemaVersion: number;
  updatedAt: string;
  models: Record<string, DeadModelEntry>;
}

function emptyCache(): DeadModelCache {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    models: {},
  };
}

export class GeminiModelCache {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultCachePath();
  }

  load(): DeadModelCache {
    if (!existsSync(this.filePath)) return emptyCache();
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `[phone-a-friend] Failed to read gemini-models cache ${this.filePath}: ${(err as Error).message}\n`,
      );
      return emptyCache();
    }
    try {
      const parsed = JSON.parse(raw) as Partial<DeadModelCache>;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.schemaVersion !== 'number' ||
        typeof parsed.models !== 'object' ||
        parsed.models === null
      ) {
        throw new Error('gemini-models cache shape is invalid');
      }
      if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
        process.stderr.write(
          `[phone-a-friend] gemini-models cache schemaVersion ${parsed.schemaVersion} does not match expected ${CACHE_SCHEMA_VERSION}; ignoring.\n`,
        );
        return emptyCache();
      }
      return {
        schemaVersion: parsed.schemaVersion,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        models: parsed.models as Record<string, DeadModelEntry>,
      };
    } catch (err) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const rotated = `${this.filePath}.corrupt-${ts}`;
      try {
        renameSync(this.filePath, rotated);
        process.stderr.write(
          `[phone-a-friend] gemini-models cache at ${this.filePath} could not be parsed (${(err as Error).message}). ` +
            `Rotated to ${rotated}. Starting empty.\n`,
        );
      } catch {
        process.stderr.write(
          `[phone-a-friend] gemini-models cache at ${this.filePath} could not be parsed (${(err as Error).message}) and could not be rotated. Starting empty.\n`,
        );
      }
      return emptyCache();
    }
  }

  save(cache: DeadModelCache): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const payload = JSON.stringify(cache, null, 2);

    const tmpFd = openSync(tmpPath, 'w');
    try {
      writeFileSync(tmpFd, payload, 'utf-8');
      fsyncSync(tmpFd);
    } finally {
      closeSync(tmpFd);
    }

    try {
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; ignore.
      }
      throw err;
    }

    try {
      const dirFd = openSync(dir, 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Directory fsync not always available; best-effort durability.
    }
  }

  isDead(model: string, now = Date.now()): boolean {
    const cache = this.load();
    return isModelDead(cache, model, now);
  }

  markDead(
    model: string,
    info: { httpStatus: number; message: string; source: string },
    now: Date = new Date(),
  ): void {
    const cache = this.load();
    const updated = markModelDead(cache, model, info, now);
    this.save(updated);
  }

  prune(now = Date.now()): void {
    const cache = this.load();
    const pruned = pruneExpired(cache, now);
    if (pruned !== cache) {
      this.save(pruned);
    }
  }
}

export function defaultCachePath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'phone-a-friend',
    'gemini-models.json',
  );
}

export function isModelDead(
  cache: DeadModelCache,
  model: string,
  now = Date.now(),
): boolean {
  const entry = cache.models[model];
  if (!entry) return false;
  const expires = Date.parse(entry.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires > now;
}

export function markModelDead(
  cache: DeadModelCache,
  model: string,
  info: { httpStatus: number; message: string; source: string },
  now: Date = new Date(),
): DeadModelCache {
  const nowIso = now.toISOString();
  const expires = new Date(now.getTime() + DEAD_MODEL_TTL_MS).toISOString();
  const existing = cache.models[model];
  const entry: DeadModelEntry = {
    status: 'unavailable',
    reason: 'not_found',
    httpStatus: info.httpStatus,
    firstSeenAt: existing?.firstSeenAt ?? nowIso,
    lastSeenAt: nowIso,
    expiresAt: expires,
    source: info.source,
    message: info.message,
  };
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    updatedAt: nowIso,
    models: { ...cache.models, [model]: entry },
  };
}

export function pruneExpired(
  cache: DeadModelCache,
  now = Date.now(),
): DeadModelCache {
  const next: Record<string, DeadModelEntry> = {};
  let changed = false;
  for (const [model, entry] of Object.entries(cache.models)) {
    const expires = Date.parse(entry.expiresAt);
    if (!Number.isNaN(expires) && expires > now) {
      next[model] = entry;
    } else {
      changed = true;
    }
  }
  if (!changed) return cache;
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    updatedAt: new Date(now).toISOString(),
    models: next,
  };
}

/**
 * Classify a Gemini CLI error from its surfaced text/exit-code so the backend
 * can decide whether to fall back, retry transiently, or fail loudly.
 *
 * Detection signals (verified empirically on gemini-cli 0.39.1):
 *   - 404 (model not found):
 *       stderr: "ModelNotFoundError: Requested entity was not found.", "code: 404"
 *       JSON output: {"error":{"message":"Requested entity was not found.","code":1}}
 *   - 429 (rate limit / capacity):
 *       stderr/JSON: "RESOURCE_EXHAUSTED" or HTTP 429 / "rate limit" / "quota"
 *   - auth: "AUTHENTICATION_FAILED" / "401" / "Permission denied"
 */
export function classifyGeminiError(input: {
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  message?: string;
}): GeminiErrorClassification {
  const haystack = [
    input.stderr ?? '',
    input.stdout ?? '',
    input.message ?? '',
  ].join('\n');

  const lower = haystack.toLowerCase();

  // Strong 404 signal: gemini's own ModelNotFoundError classifier.
  // This is the only signal reliable enough to cache a model as dead for 24h.
  if (/modelnotfounderror/i.test(haystack)) {
    return {
      kind: 'model-not-found',
      message: extractErrorMessage(haystack) ?? 'Gemini model not found (404)',
      httpStatus: 404,
      cacheable: true,
    };
  }

  // Ambiguous 404 signals: still treat as model-not-found for fallback purposes,
  // but do NOT cache. A bare "Requested entity was not found." or `"code": 404`
  // could be a missing project, file, or other non-model resource.
  if (
    /requested entity was not found/i.test(haystack) ||
    /\bcode:\s*404\b/.test(haystack) ||
    /"code"\s*:\s*404/.test(haystack)
  ) {
    return {
      kind: 'model-not-found',
      message: extractErrorMessage(haystack) ?? 'Gemini reported a 404, possibly model-related',
      httpStatus: 404,
      cacheable: false,
    };
  }

  if (
    /resource_exhausted/i.test(haystack) ||
    /\b429\b/.test(haystack) ||
    /rate.?limit/.test(lower) ||
    /quota/.test(lower) ||
    /capacity/.test(lower)
  ) {
    return {
      kind: 'rate-limit',
      message: extractErrorMessage(haystack) ?? 'Gemini reported capacity or rate-limit pressure',
      httpStatus: 429,
    };
  }

  if (
    /authentication.?failed/i.test(haystack) ||
    /\b401\b/.test(haystack) ||
    /permission denied/i.test(lower) ||
    /api key/i.test(lower)
  ) {
    return {
      kind: 'auth',
      message: extractErrorMessage(haystack) ?? 'Gemini reported an authentication problem',
      httpStatus: 401,
    };
  }

  return {
    kind: 'other',
    message: extractErrorMessage(haystack) ?? 'unknown Gemini error',
  };
}

function extractErrorMessage(text: string): string | undefined {
  const jsonMatch = text.match(/"message"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const errMatch = text.match(/Error:\s*([^\n]+)/);
  if (errMatch) return errMatch[1].trim();
  return undefined;
}

/**
 * Build the ordered list of models to attempt for a given request, given the
 * cache state. The caller's preferred model leads, followed by the fallback
 * chain (deduped, preferred-removed). Models marked dead in the cache are
 * filtered out — they are still skipped before spawning gemini at all.
 *
 * If everything is dead, the chain is empty and the caller should surface
 * a single clear error.
 */
export function buildAttemptChain(
  preferred: string | null | undefined,
  cache: DeadModelCache,
  now = Date.now(),
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  const candidates = [preferred ?? DEFAULT_GEMINI_MODEL, ...GEMINI_FALLBACK_CHAIN];
  for (const model of candidates) {
    if (!model) continue;
    if (seen.has(model)) continue;
    seen.add(model);
    if (isModelDead(cache, model, now)) continue;
    chain.push(model);
  }
  return chain;
}

export function isAutoFallbackDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK;
  if (!value) return false;
  return /^(0|false|no|off)$/i.test(value.trim());
}

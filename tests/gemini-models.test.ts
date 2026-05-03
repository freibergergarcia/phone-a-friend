import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CACHE_SCHEMA_VERSION,
  classifyGeminiError,
  DEAD_MODEL_TTL_MS,
  GeminiModelCache,
  isDeadCacheDisabled,
  isModelDead,
  markModelDead,
  pruneExpired,
  type DeadModelCache,
} from '../src/gemini-models.js';

function emptyCache(): DeadModelCache {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    models: {},
  };
}

function freshDeadEntry(model: string, now: Date) {
  const expires = new Date(now.getTime() + DEAD_MODEL_TTL_MS).toISOString();
  return {
    [model]: {
      status: 'unavailable' as const,
      reason: 'not_found' as const,
      httpStatus: 404,
      firstSeenAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expires,
      source: 'relay-failure',
      message: 'model not found',
    },
  };
}

describe('classifyGeminiError', () => {
  it('detects strong 404 from ModelNotFoundError stderr (cacheable)', () => {
    const result = classifyGeminiError({
      stderr: 'ModelNotFoundError: Requested entity was not found.\n  code: 404',
      exitCode: 1,
    });
    expect(result.kind).toBe('model-not-found');
    expect(result.httpStatus).toBe(404);
    expect(result.cacheable).toBe(true);
  });

  it('detects ambiguous 404 without ModelNotFoundError (NOT cacheable)', () => {
    const result = classifyGeminiError({
      stdout: '{"session_id":"abc","error":{"type":"Error","message":"Requested entity was not found.","code":1}}',
      exitCode: 1,
    });
    expect(result.kind).toBe('model-not-found');
    expect(result.message).toContain('Requested entity was not found');
    expect(result.cacheable).toBe(false);
  });

  it('does not cache a bare code:404 hint without model context', () => {
    const result = classifyGeminiError({
      stderr: 'oops, code: 404',
    });
    expect(result.kind).toBe('model-not-found');
    expect(result.cacheable).toBe(false);
  });

  it('detects rate limit from RESOURCE_EXHAUSTED', () => {
    const result = classifyGeminiError({
      stderr: 'Error: RESOURCE_EXHAUSTED quota exceeded',
      exitCode: 1,
    });
    expect(result.kind).toBe('rate-limit');
    expect(result.httpStatus).toBe(429);
  });

  it('detects rate limit from 429 status', () => {
    const result = classifyGeminiError({
      stderr: 'API returned 429 too many requests',
      exitCode: 1,
    });
    expect(result.kind).toBe('rate-limit');
  });

  it('detects auth errors', () => {
    const result = classifyGeminiError({
      stderr: 'AUTHENTICATION_FAILED: please run gemini login',
    });
    expect(result.kind).toBe('auth');
  });

  it('falls through to "other" for unknown errors', () => {
    const result = classifyGeminiError({
      stderr: 'totally unexpected failure mode',
    });
    expect(result.kind).toBe('other');
  });

  it('handles empty input gracefully', () => {
    const result = classifyGeminiError({});
    expect(result.kind).toBe('other');
    expect(result.message).toBeDefined();
  });
});

describe('isModelDead', () => {
  const now = new Date('2026-05-02T00:00:00.000Z').getTime();

  it('returns false for unknown model', () => {
    const cache = emptyCache();
    expect(isModelDead(cache, 'gemini-unknown', now)).toBe(false);
  });

  it('returns true for a fresh dead entry', () => {
    const dt = new Date(now);
    const cache: DeadModelCache = {
      ...emptyCache(),
      models: freshDeadEntry('gemini-3.1-pro-preview', dt),
    };
    expect(isModelDead(cache, 'gemini-3.1-pro-preview', now + 1000)).toBe(true);
  });

  it('returns false for an expired dead entry', () => {
    const dt = new Date(now);
    const cache: DeadModelCache = {
      ...emptyCache(),
      models: freshDeadEntry('gemini-3.1-pro-preview', dt),
    };
    expect(isModelDead(cache, 'gemini-3.1-pro-preview', now + DEAD_MODEL_TTL_MS + 1000)).toBe(false);
  });

  it('returns false when expiresAt cannot be parsed', () => {
    const cache: DeadModelCache = {
      ...emptyCache(),
      models: {
        'broken': {
          status: 'unavailable',
          reason: 'not_found',
          httpStatus: 404,
          firstSeenAt: 'never',
          lastSeenAt: 'never',
          expiresAt: 'never',
          source: 'test',
          message: 'broken',
        },
      },
    };
    expect(isModelDead(cache, 'broken', now)).toBe(false);
  });
});

describe('markModelDead', () => {
  const now = new Date('2026-05-02T00:00:00.000Z');

  it('creates a new entry with TTL applied', () => {
    const updated = markModelDead(emptyCache(), 'gemini-x', {
      httpStatus: 404,
      message: 'gone',
      source: 'relay-failure',
    }, now);
    const entry = updated.models['gemini-x'];
    expect(entry).toBeDefined();
    expect(entry.firstSeenAt).toBe(now.toISOString());
    expect(entry.lastSeenAt).toBe(now.toISOString());
    expect(Date.parse(entry.expiresAt) - now.getTime()).toBe(DEAD_MODEL_TTL_MS);
    expect(entry.source).toBe('relay-failure');
  });

  it('preserves firstSeenAt on re-mark', () => {
    const earlier = new Date(now.getTime() - 60_000);
    const initial = markModelDead(emptyCache(), 'gemini-x', {
      httpStatus: 404,
      message: 'first',
      source: 'relay-failure',
    }, earlier);
    const updated = markModelDead(initial, 'gemini-x', {
      httpStatus: 404,
      message: 'second',
      source: 'relay-failure',
    }, now);
    const entry = updated.models['gemini-x'];
    expect(entry.firstSeenAt).toBe(earlier.toISOString());
    expect(entry.lastSeenAt).toBe(now.toISOString());
    expect(entry.message).toBe('second');
  });
});

describe('pruneExpired', () => {
  const now = new Date('2026-05-02T00:00:00.000Z').getTime();

  it('removes expired entries', () => {
    const cache: DeadModelCache = {
      ...emptyCache(),
      models: {
        ...freshDeadEntry('expired', new Date(now - DEAD_MODEL_TTL_MS - 1000)),
        ...freshDeadEntry('fresh', new Date(now)),
      },
    };
    const pruned = pruneExpired(cache, now);
    expect(pruned.models['expired']).toBeUndefined();
    expect(pruned.models['fresh']).toBeDefined();
  });

  it('returns the same instance when nothing changed', () => {
    const cache: DeadModelCache = {
      ...emptyCache(),
      models: freshDeadEntry('fresh', new Date(now)),
    };
    const pruned = pruneExpired(cache, now);
    expect(pruned).toBe(cache);
  });
});

describe('isDeadCacheDisabled', () => {
  it('returns false when env var is unset', () => {
    expect(isDeadCacheDisabled({})).toBe(false);
  });

  it.each(['0', 'false', 'FALSE', 'no', 'off', '  false  '])('returns true for %s', (value) => {
    expect(isDeadCacheDisabled({ PHONE_A_FRIEND_GEMINI_DEAD_CACHE: value })).toBe(true);
  });

  it.each(['1', 'true', 'yes', 'on', 'enabled'])('returns false for truthy %s', (value) => {
    expect(isDeadCacheDisabled({ PHONE_A_FRIEND_GEMINI_DEAD_CACHE: value })).toBe(false);
  });
});

describe('GeminiModelCache (filesystem)', () => {
  let tmpDir: string;
  let cachePath: string;
  let cache: GeminiModelCache;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gemini-models-'));
    cachePath = join(tmpDir, 'gemini-models.json');
    cache = new GeminiModelCache(cachePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty cache when file is missing', () => {
    const loaded = cache.load();
    expect(loaded.schemaVersion).toBe(CACHE_SCHEMA_VERSION);
    expect(loaded.models).toEqual({});
  });

  it('round-trips a save then load', () => {
    cache.markDead('gemini-3.1-pro-preview', {
      httpStatus: 404,
      message: 'Requested entity was not found.',
      source: 'relay-failure',
    });
    const loaded = cache.load();
    expect(loaded.models['gemini-3.1-pro-preview']).toBeDefined();
    expect(loaded.models['gemini-3.1-pro-preview'].httpStatus).toBe(404);
    expect(loaded.schemaVersion).toBe(CACHE_SCHEMA_VERSION);
  });

  it('getDeadEntry returns the live entry for a dead model', () => {
    cache.markDead('gemini-fake-404', {
      httpStatus: 404,
      message: 'ModelNotFoundError',
      source: 'relay-failure',
    });
    const entry = cache.getDeadEntry('gemini-fake-404');
    expect(entry).toBeDefined();
    expect(entry?.httpStatus).toBe(404);
    expect(entry?.source).toBe('relay-failure');
    expect(entry?.expiresAt).toBeDefined();
    expect(Date.parse(entry!.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('getDeadEntry returns undefined for unknown models', () => {
    expect(cache.getDeadEntry('never-cached')).toBeUndefined();
  });

  it('getDeadEntry returns undefined for expired entries', () => {
    const past = new Date(Date.now() - 2 * DEAD_MODEL_TTL_MS);
    cache.markDead(
      'gemini-expired',
      {
        httpStatus: 404,
        message: 'ModelNotFoundError',
        source: 'relay-failure',
      },
      past,
    );
    expect(cache.getDeadEntry('gemini-expired')).toBeUndefined();
  });

  it('getCachePath returns the absolute path of the cache file', () => {
    expect(cache.getCachePath()).toBe(cachePath);
  });

  it('rotates and recovers from corrupt JSON', () => {
    writeFileSync(cachePath, 'not valid json {{{', 'utf-8');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const loaded = cache.load();
    expect(loaded.models).toEqual({});
    const remaining = readdirSync(tmpDir);
    expect(remaining.some((f) => f.includes('.corrupt-'))).toBe(true);
    stderrSpy.mockRestore();
  });

  it('returns empty when schemaVersion mismatches', () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ schemaVersion: 999, updatedAt: new Date().toISOString(), models: {} }),
      'utf-8',
    );
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const loaded = cache.load();
    expect(loaded.models).toEqual({});
    expect(loaded.schemaVersion).toBe(CACHE_SCHEMA_VERSION);
    stderrSpy.mockRestore();
  });

  it('atomic write does not leave .tmp files behind on success', () => {
    cache.markDead('gemini-x', {
      httpStatus: 404,
      message: 'gone',
      source: 'relay-failure',
    });
    const remaining = readdirSync(tmpDir);
    expect(remaining.some((f) => f.includes('.tmp.'))).toBe(false);
    expect(remaining).toContain('gemini-models.json');
  });

  it('isDead reflects what was persisted', () => {
    expect(cache.isDead('gemini-x')).toBe(false);
    cache.markDead('gemini-x', {
      httpStatus: 404,
      message: 'gone',
      source: 'relay-failure',
    });
    expect(cache.isDead('gemini-x')).toBe(true);
  });

  it('prune persists pruned cache when entries expire', () => {
    const then = new Date('2026-05-02T00:00:00.000Z');
    cache.markDead('expired', {
      httpStatus: 404,
      message: 'gone',
      source: 'relay-failure',
    }, then);
    cache.markDead('fresh', {
      httpStatus: 404,
      message: 'gone',
      source: 'relay-failure',
    }, then);

    const future = then.getTime() + DEAD_MODEL_TTL_MS + 1000;
    // Re-add a fresh entry by calling markDead again with a recent timestamp.
    cache.markDead('fresh', {
      httpStatus: 404,
      message: 'still gone',
      source: 'relay-failure',
    }, new Date(future));

    cache.prune(future + 1000);
    const persisted = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(persisted.models['expired']).toBeUndefined();
    expect(persisted.models['fresh']).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { SandboxMode } from '../../src/backends/index.js';

// vi.hoisted runs before vi.mock hoisting
const { mockExecFileSync, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync, spawn: mockSpawn };
});

import { GEMINI_BACKEND, GeminiBackendError } from '../../src/backends/gemini.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeChild(exitCode = 0, stdout = '', stderr = '') {
  const child = new EventEmitter();
  (child as any).stdout = new PassThrough();
  (child as any).stderr = new PassThrough();
  (child as any).killed = false;
  (child as any).kill = vi.fn();
  process.nextTick(() => {
    if (stdout) (child as any).stdout.write(stdout);
    (child as any).stdout.end();
    if (stderr) (child as any).stderr.write(stderr);
    (child as any).stderr.end();
    child.emit('close', exitCode, null);
  });
  return child;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeminiBackend', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and allowed sandboxes', () => {
    expect(GEMINI_BACKEND.name).toBe('gemini');
    expect(GEMINI_BACKEND.allowedSandboxes.has('read-only')).toBe(true);
    expect(GEMINI_BACKEND.allowedSandboxes.has('workspace-write')).toBe(true);
    expect(GEMINI_BACKEND.allowedSandboxes.has('danger-full-access')).toBe(true);
  });

  it('declares resumeStrategy as "unsupported"', () => {
    // Gemini's session surface (session ID extraction, --resume semantics) is
    // unverified against live CLI output and run() does not use sessionHistory.
    // The relay layer relies on this flag to reject --session for Gemini
    // instead of silently fresh-spawning. If this assertion fails, double-check
    // src/backends/gemini.ts and the unsupported-session guard in src/relay.ts.
    expect(GEMINI_BACKEND.capabilities.resumeStrategy).toBe('unsupported');
  });

  it('builds correct gemini CLI args and reads stdout', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    let capturedArgs: string[] = [];
    let capturedOpts: Record<string, unknown> = {};
    mockSpawn.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
      capturedArgs = args;
      capturedOpts = opts;
      return fakeChild(0, 'Gemini feedback');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'Review implementation.',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('Gemini feedback');
    expect(capturedArgs).toContain('--sandbox');
    expect(capturedArgs).toContain('--yolo');
    expect(capturedArgs).toContain('--include-directories');
    expect(capturedArgs).toContain('/tmp/repo');
    expect(capturedArgs).toContain('--output-format');
    expect(capturedArgs).toContain('text');
    // Prompt passed via --prompt flag
    const promptIdx = capturedArgs.indexOf('--prompt');
    expect(promptIdx).toBeGreaterThan(-1);
    expect(capturedArgs[promptIdx + 1]).toBe('Review implementation.');
    // No exec subcommand (unlike codex)
    expect(capturedArgs).not.toContain('exec');
    // cwd should be set to repo path
    expect(capturedOpts.cwd).toBe('/tmp/repo');
  });

  it('omits --sandbox for danger-full-access', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild(0, 'ok');
    });

    await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'danger-full-access' as SandboxMode,
      model: null,
      env: {},
    });

    expect(capturedArgs).not.toContain('--sandbox');
    // --yolo is always passed
    expect(capturedArgs).toContain('--yolo');
  });

  it('passes --sandbox for read-only', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild(0, 'ok');
    });

    await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(capturedArgs).toContain('--sandbox');
  });

  it('passes --sandbox for workspace-write', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild(0, 'ok');
    });

    await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'workspace-write' as SandboxMode,
      model: null,
      env: {},
    });

    expect(capturedArgs).toContain('--sandbox');
  });

  it('passes -m when model is provided', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild(0, 'model feedback');
    });

    await GEMINI_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: 'gemini-2.5-flash',
      env: {},
    });

    const modelIdx = capturedArgs.indexOf('-m');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(capturedArgs[modelIdx + 1]).toBe('gemini-2.5-flash');
  });

  it('does not pass -m when model is null', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild(0, 'ok');
    });

    await GEMINI_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(capturedArgs).not.toContain('-m');
  });

  it('throws GeminiBackendError when gemini not found in PATH', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') throw new Error('not found');
      return '';
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/gemini CLI not found/);
  });

  it('throws on timeout', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    mockSpawn.mockImplementation(() => {
      const child = new EventEmitter();
      (child as any).stdout = new PassThrough();
      (child as any).stderr = new PassThrough();
      (child as any).killed = false;
      (child as any).kill = vi.fn(() => {
        // Simulate SIGTERM kill — close with null code and SIGTERM signal
        (child as any).stdout.end();
        (child as any).stderr.end();
        child.emit('close', null, 'SIGTERM');
      });
      // Don't emit close — let the timeout fire
      return child;
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 0.01,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('throws on non-zero exit code with stderr', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    mockSpawn.mockImplementation(() => fakeChild(1, '', 'something went wrong'));

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow('something went wrong');
  });

  it('throws when gemini produces no output', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    mockSpawn.mockImplementation(() => fakeChild(0, '', ''));

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/without producing output/);
  });

  it('always passes --yolo flag', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });

    // Test with both sandbox modes to confirm --yolo is always present
    for (const sandbox of ['read-only', 'danger-full-access'] as SandboxMode[]) {
      let capturedArgs: string[] = [];
      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        capturedArgs = args;
        return fakeChild(0, 'ok');
      });

      await GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox,
        model: null,
        env: {},
      });

      expect(capturedArgs).toContain('--yolo');
    }
  });
});

// ---------------------------------------------------------------------------
// Auto-fallback tests (Feature #4)
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('GeminiBackend dead-model cache', () => {
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    tmpDir = mkdtempSync(join(tmpdir(), 'gemini-fallback-'));
    // Redirect XDG so the cache lands in tmp.
    vi.stubEnv('XDG_CONFIG_HOME', tmpDir);
    vi.stubEnv('PHONE_A_FRIEND_GEMINI_DEAD_CACHE', '');
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/gemini';
      throw new Error(`unexpected execFileSync call: ${cmd}`);
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    stderrSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('strong 404 (ModelNotFoundError) caches the model and surfaces a clear error', async () => {
    let calls = 0;
    mockSpawn.mockImplementation(() => {
      calls++;
      return fakeChild(1, '', 'ModelNotFoundError: Requested entity was not found.\n  code: 404');
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-stale-preview',
        env: {},
      }),
    ).rejects.toThrow(
      /Model `gemini-stale-preview` returned 404 from Gemini.*Cached as unavailable until.*PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false/s,
    );

    // Single attempt, no fallback spawn.
    expect(calls).toBe(1);

    // Cache file should now have the entry.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    expect(cache.isDead('gemini-stale-preview')).toBe(true);
    const entry = cache.getDeadEntry('gemini-stale-preview');
    expect(entry?.source).toBe('relay-failure');
    expect(entry?.httpStatus).toBe(404);
  });

  it('cache hit fails fast with no spawn', async () => {
    // Pre-populate the cache.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    cache.markDead('gemini-pinned-dead', {
      httpStatus: 404,
      message: 'previously dead',
      source: 'test',
    });

    let calls = 0;
    mockSpawn.mockImplementation(() => {
      calls++;
      return fakeChild(0, 'should not be called');
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-pinned-dead',
        env: {},
      }),
    ).rejects.toThrow(
      /Model `gemini-pinned-dead` returned 404.*Cached as unavailable until.*PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false/s,
    );
    // No spawn should occur on a cache hit.
    expect(calls).toBe(0);
  });

  it('error message does NOT recommend any fallback model names', async () => {
    mockSpawn.mockImplementation(() => {
      return fakeChild(1, '', 'ModelNotFoundError: Requested entity was not found.\n  code: 404');
    });

    let caught: Error | undefined;
    try {
      await GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-pinned-fail',
        env: {},
      });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    const msg = caught!.message;
    // No fallback model names should appear (including those formerly in the priority list).
    expect(msg).not.toMatch(/gemini-2\.5-flash\b/);
    expect(msg).not.toMatch(/gemini-2\.5-flash-lite/);
    expect(msg).not.toMatch(/gemini-2\.5-pro/);
    expect(msg).not.toMatch(/gemini-3-flash-preview/);
    expect(msg).not.toMatch(/try .*gemini-/i);
    // The requested model name IS allowed (it's the user's pin).
    expect(msg).toContain('gemini-pinned-fail');
  });

  it('does not cache an ambiguous 404 (no ModelNotFoundError marker)', async () => {
    let calls = 0;
    mockSpawn.mockImplementation(() => {
      calls++;
      // Ambiguous 404 — could be the model, could be a missing project, etc.
      return fakeChild(1, '', 'oops, code: 404\nRequested entity was not found.');
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-ambiguous',
        env: {},
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);

    // Verify the cache file was not written for this model.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    expect(cache.isDead('gemini-ambiguous')).toBe(false);
  });

  it('does not cache rate-limit (429 / RESOURCE_EXHAUSTED) errors', async () => {
    let calls = 0;
    mockSpawn.mockImplementation(() => {
      calls++;
      return fakeChild(1, '', 'Error: RESOURCE_EXHAUSTED quota exceeded');
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-busy',
        env: {},
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);

    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    expect(cache.isDead('gemini-busy')).toBe(false);
  });

  it('rethrows auth errors without caching', async () => {
    let calls = 0;
    mockSpawn.mockImplementation(() => {
      calls++;
      return fakeChild(1, '', 'AUTHENTICATION_FAILED: not logged in');
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-2.5-flash',
        env: {},
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);

    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    expect(cache.isDead('gemini-2.5-flash')).toBe(false);
  });

  it('skips the cache entirely when PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false', async () => {
    vi.stubEnv('PHONE_A_FRIEND_GEMINI_DEAD_CACHE', 'false');

    // Pre-populate the cache so the model would normally fail fast.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    cache.markDead('gemini-pinned-dead', {
      httpStatus: 404,
      message: 'previously dead',
      source: 'test',
    });

    let calls = 0;
    mockSpawn.mockImplementation(() => {
      calls++;
      return fakeChild(1, '', 'ModelNotFoundError: Requested entity was not found.\n  code: 404');
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-pinned-dead',
        env: {},
      }),
    ).rejects.toThrow();
    // With cache disabled, the model is attempted (and fails normally).
    expect(calls).toBe(1);
  });

  it('honors PHONE_A_FRIEND_GEMINI_DEAD_CACHE from opts.env, not just process.env', async () => {
    // Pre-populate the cache so the model would normally fail fast.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    cache.markDead('gemini-pinned-dead', {
      httpStatus: 404,
      message: 'previously dead',
      source: 'test',
    });

    let calls = 0;
    mockSpawn.mockImplementation(() => {
      calls++;
      return fakeChild(0, 'env override worked');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-pinned-dead',
      env: { PHONE_A_FRIEND_GEMINI_DEAD_CACHE: 'false' },
    });
    expect(result).toBe('env override worked');
    expect(calls).toBe(1);
  });

  it('does not consult the cache when model is null (auto-routing path)', async () => {
    let calls = 0;
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      calls++;
      // No -m argument should be present.
      expect(args).not.toContain('-m');
      return fakeChild(0, 'auto-routed');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: {},
    });
    expect(result).toBe('auto-routed');
    expect(calls).toBe(1);
  });

  it('does not consult the cache during session resume', async () => {
    // Pre-populate the cache.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    cache.markDead('gemini-2.5-flash', {
      httpStatus: 404,
      message: 'previously dead',
      source: 'test',
    });

    let calls = 0;
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      calls++;
      expect(args).toContain('--resume');
      return fakeChild(0, 'resume worked');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-2.5-flash',
      env: {},
      resumeSession: true,
      sessionId: 'abc-123',
    });
    expect(result).toBe('resume worked');
    expect(calls).toBe(1);
  });

  it('still serves a relay when the cache file is corrupt (rotates and continues)', async () => {
    // Write garbage to the cache file.
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(tmpDir, 'phone-a-friend'), { recursive: true });
    writeFileSync(join(tmpDir, 'phone-a-friend', 'gemini-models.json'), 'not valid json {{{', 'utf-8');

    mockSpawn.mockImplementation(() => fakeChild(0, 'survived corrupt cache'));

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-2.5-flash',
      env: {},
    });
    expect(result).toBe('survived corrupt cache');
  });
});

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

describe('GeminiBackend auto-fallback', () => {
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    tmpDir = mkdtempSync(join(tmpdir(), 'gemini-fallback-'));
    // Redirect XDG so the cache lands in tmp.
    vi.stubEnv('XDG_CONFIG_HOME', tmpDir);
    vi.stubEnv('PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK', '');
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

  it('falls back to the next model when the first returns 404', async () => {
    const calls: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const modelIdx = args.indexOf('-m');
      const model = modelIdx >= 0 ? args[modelIdx + 1] : '';
      calls.push(model);
      if (model === 'gemini-stale-preview') {
        return fakeChild(1, '', 'ModelNotFoundError: Requested entity was not found.\n  code: 404');
      }
      return fakeChild(0, 'fallback worked');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-stale-preview',
      env: {},
    });

    expect(result).toBe('fallback worked');
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]).toBe('gemini-stale-preview');
    expect(calls[1]).toBe('gemini-2.5-flash');
    // Stderr fallback notice should fire on the failed attempt.
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderrText).toMatch(/falling back/);
    expect(stderrText).toMatch(/Cached for 24h/);
  });

  it('falls back on rate-limit without caching as dead', async () => {
    const calls: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const modelIdx = args.indexOf('-m');
      const model = modelIdx >= 0 ? args[modelIdx + 1] : '';
      calls.push(model);
      if (model === 'gemini-2.5-flash' && calls.filter((m) => m === model).length === 1) {
        return fakeChild(1, '', 'Error: RESOURCE_EXHAUSTED quota exceeded');
      }
      return fakeChild(0, 'survived rate limit');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-2.5-flash',
      env: {},
    });

    expect(result).toBe('survived rate limit');
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderrText).toMatch(/rate-limit/);
    expect(stderrText).not.toMatch(/Cached for 24h/);
  });

  it('rethrows auth errors without falling back', async () => {
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
  });

  it('disables fallback when PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK=false', async () => {
    vi.stubEnv('PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK', 'false');
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
        model: 'gemini-2.5-flash',
        env: {},
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('does not engage fallback when model is null (legacy behavior)', async () => {
    let calls = 0;
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      calls++;
      // No -m argument should be present
      expect(args).not.toContain('-m');
      return fakeChild(0, 'legacy default');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: {},
    });

    expect(result).toBe('legacy default');
    expect(calls).toBe(1);
  });

  it('does not engage fallback during session resume', async () => {
    let calls = 0;
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      calls++;
      expect(args).toContain('--resume');
      return fakeChild(1, '', 'ModelNotFoundError: Requested entity was not found.\n  code: 404');
    });

    await expect(
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only',
        model: 'gemini-2.5-flash',
        env: {},
        resumeSession: true,
        sessionId: 'abc-123',
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('throws an aggregated error when every attempt fails', async () => {
    mockSpawn.mockImplementation(() => {
      return fakeChild(1, '', 'ModelNotFoundError: Requested entity was not found.\n  code: 404');
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
    ).rejects.toThrow(/auto-fallback exhausted/);
  });

  it('skips models the cache already knows are dead', async () => {
    // Pre-populate the cache so gemini-2.5-flash is dead.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    cache.markDead('gemini-2.5-flash', {
      httpStatus: 404,
      message: 'previously dead',
      source: 'test',
    });

    const calls: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const modelIdx = args.indexOf('-m');
      const model = modelIdx >= 0 ? args[modelIdx + 1] : '';
      calls.push(model);
      return fakeChild(0, 'lite was used');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-2.5-flash',
      env: {},
    });

    expect(result).toBe('lite was used');
    expect(calls).not.toContain('gemini-2.5-flash');
    expect(calls[0]).toBe('gemini-2.5-flash-lite');
  });

  it('emits a cache-skip banner when the requested model is filtered out', async () => {
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    cache.markDead('gemini-2.5-flash', {
      httpStatus: 404,
      message: 'previously dead',
      source: 'test',
    });

    mockSpawn.mockImplementation(() => fakeChild(0, 'lite'));

    await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-2.5-flash',
      env: {},
    });

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderrText).toMatch(/cached as unavailable/);
    expect(stderrText).toMatch(/gemini-2\.5-flash/);
    expect(stderrText).toMatch(/using gemini-2\.5-flash-lite/);
  });

  it('does not cache an ambiguous 404 (no ModelNotFoundError marker)', async () => {
    const calls: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const modelIdx = args.indexOf('-m');
      const model = modelIdx >= 0 ? args[modelIdx + 1] : '';
      calls.push(model);
      if (model === 'gemini-pro-experimental') {
        // Ambiguous 404 — could be the model, could be a missing project, etc.
        return fakeChild(1, '', 'oops, code: 404\nRequested entity was not found.');
      }
      return fakeChild(0, 'fallback worked');
    });

    const result = await GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: 'gemini-pro-experimental',
      env: {},
    });

    expect(result).toBe('fallback worked');
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    // Banner says falling back, but does NOT claim it cached.
    expect(stderrText).toMatch(/falling back/);
    expect(stderrText).not.toMatch(/Cached for 24h/);

    // Verify the cache file was not written for this model.
    const { GeminiModelCache } = await import('../../src/gemini-models.js');
    const cache = new GeminiModelCache(join(tmpDir, 'phone-a-friend', 'gemini-models.json'));
    expect(cache.isDead('gemini-pro-experimental')).toBe(false);
  });

  it('honors PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK from opts.env, not just process.env', async () => {
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
        model: 'gemini-2.5-flash',
        env: { PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK: 'false' },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

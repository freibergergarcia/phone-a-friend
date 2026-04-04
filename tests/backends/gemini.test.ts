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

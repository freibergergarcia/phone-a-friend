import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SandboxMode } from '../../src/backends/index.js';

// vi.hoisted runs before vi.mock hoisting
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync };
});

import { GEMINI_BACKEND, GeminiBackendError } from '../../src/backends/gemini.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeminiBackend', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
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

  it('builds correct gemini CLI args and reads stdout', () => {
    let observedOpts: Record<string, unknown> = {};

    mockExecFileSync.mockImplementation(
      (cmd: string, args: string[], opts?: Record<string, unknown>) => {
        if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
        observedOpts = opts ?? {};
        return Buffer.from('Gemini feedback');
      },
    );

    const result = GEMINI_BACKEND.run({
      prompt: 'Review implementation.',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('Gemini feedback');

    const geminiCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'gemini',
    );
    expect(geminiCall).toBeDefined();
    const args = geminiCall![1] as string[];

    expect(args).toContain('--sandbox');
    expect(args).toContain('--yolo');
    expect(args).toContain('--include-directories');
    expect(args).toContain('/tmp/repo');
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
    // Prompt passed via --prompt flag
    const promptIdx = args.indexOf('--prompt');
    expect(promptIdx).toBeGreaterThan(-1);
    expect(args[promptIdx + 1]).toBe('Review implementation.');
    // No exec subcommand (unlike codex)
    expect(args).not.toContain('exec');
    // cwd should be set to repo path
    expect(observedOpts.cwd).toBe('/tmp/repo');
  });

  it('omits --sandbox for danger-full-access', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      return Buffer.from('ok');
    });

    GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'danger-full-access' as SandboxMode,
      model: null,
      env: {},
    });

    const geminiCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'gemini',
    );
    const args = geminiCall![1] as string[];
    expect(args).not.toContain('--sandbox');
    // --yolo is always passed
    expect(args).toContain('--yolo');
  });

  it('passes --sandbox for read-only', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      return Buffer.from('ok');
    });

    GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    const geminiCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'gemini',
    );
    const args = geminiCall![1] as string[];
    expect(args).toContain('--sandbox');
  });

  it('passes --sandbox for workspace-write', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      return Buffer.from('ok');
    });

    GEMINI_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'workspace-write' as SandboxMode,
      model: null,
      env: {},
    });

    const geminiCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'gemini',
    );
    const args = geminiCall![1] as string[];
    expect(args).toContain('--sandbox');
  });

  it('passes -m when model is provided', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      return Buffer.from('model feedback');
    });

    GEMINI_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: 'gemini-2.5-flash',
      env: {},
    });

    const geminiCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'gemini',
    );
    const args = geminiCall![1] as string[];
    const modelIdx = args.indexOf('-m');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('gemini-2.5-flash');
  });

  it('does not pass -m when model is null', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      return Buffer.from('ok');
    });

    GEMINI_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    const geminiCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'gemini',
    );
    const args = geminiCall![1] as string[];
    expect(args).not.toContain('-m');
  });

  it('throws GeminiBackendError when gemini not found in PATH', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') throw new Error('not found');
      return Buffer.from('');
    });

    expect(() =>
      GEMINI_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).toThrow(/gemini CLI not found/);
  });

  it('throws on timeout', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      const err = new Error('TIMEOUT') as Error & {
        killed: boolean;
        signal: string;
        code: string;
      };
      err.killed = true;
      err.signal = 'SIGTERM';
      err.code = 'ETIMEDOUT';
      throw err;
    });

    expect(() =>
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 10,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).toThrow(/timed out/);
  });

  it('throws on non-zero exit code with stderr', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      const err = new Error('command failed') as Error & {
        status: number;
        stdout: Buffer;
        stderr: Buffer;
      };
      err.status = 1;
      err.stdout = Buffer.from('');
      err.stderr = Buffer.from('something went wrong');
      throw err;
    });

    expect(() =>
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).toThrow('something went wrong');
  });

  it('throws when gemini produces no output', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      return Buffer.from('');
    });

    expect(() =>
      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).toThrow(/without producing output/);
  });

  it('always passes --yolo flag', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
      return Buffer.from('ok');
    });

    // Test with both sandbox modes to confirm --yolo is always present
    for (const sandbox of ['read-only', 'danger-full-access'] as SandboxMode[]) {
      mockExecFileSync.mockClear();
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return Buffer.from('/usr/local/bin/gemini');
        return Buffer.from('ok');
      });

      GEMINI_BACKEND.run({
        prompt: 'x',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox,
        model: null,
        env: {},
      });

      const geminiCall = mockExecFileSync.mock.calls.find(
        (c: unknown[]) => c[0] === 'gemini',
      );
      const args = geminiCall![1] as string[];
      expect(args).toContain('--yolo');
    }
  });
});

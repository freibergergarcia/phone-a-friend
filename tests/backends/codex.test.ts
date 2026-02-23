import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import type { SandboxMode } from '../../src/backends/index.js';

// vi.hoisted runs before vi.mock hoisting — safe to reference in factory
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync };
});

// Import AFTER mock is set up
import { CODEX_BACKEND, CodexBackendError } from '../../src/backends/codex.js';
import type { ReviewOptions, SandboxMode as SandboxModeType } from '../../src/backends/index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodexBackend', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and allowed sandboxes', () => {
    expect(CODEX_BACKEND.name).toBe('codex');
    expect(CODEX_BACKEND.allowedSandboxes.has('read-only')).toBe(true);
    expect(CODEX_BACKEND.allowedSandboxes.has('workspace-write')).toBe(true);
    expect(CODEX_BACKEND.allowedSandboxes.has('danger-full-access')).toBe(true);
  });

  it('builds correct codex exec args', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      // which check
      if (cmd === 'which') return '/usr/local/bin/codex';
      // codex exec — write output file
      const outputIdx = args.indexOf('--output-last-message') + 1;
      if (outputIdx > 0) {
        fs.writeFileSync(args[outputIdx], 'Codex feedback');
      }
      return '';
    });

    const result = await CODEX_BACKEND.run({
      prompt: 'Review this code',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('Codex feedback');

    // Find the codex exec call (not the which call)
    const codexCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'codex',
    );
    expect(codexCall).toBeDefined();
    const args = codexCall![1] as string[];
    expect(args[0]).toBe('exec');
    expect(args).toContain('-C');
    expect(args).toContain('/tmp/repo');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
    expect(args).toContain('--output-last-message');
    // Prompt is the last arg
    expect(args[args.length - 1]).toContain('Review this code');
  });

  it('passes -m when model is provided', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      const outputIdx = args.indexOf('--output-last-message') + 1;
      if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
      return '';
    });

    await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: 'o3',
      env: {},
    });

    const codexCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'codex',
    );
    const args = codexCall![1] as string[];
    const modelIdx = args.indexOf('-m');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('o3');
  });

  it('does not pass -m when model is null', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      const outputIdx = args.indexOf('--output-last-message') + 1;
      if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
      return '';
    });

    await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    const codexCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'codex',
    );
    const args = codexCall![1] as string[];
    expect(args).not.toContain('-m');
  });

  it('reads result from temp output file', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      const outputIdx = args.indexOf('--output-last-message') + 1;
      if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'File-based output');
      return '';
    });

    const result = await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('File-based output');
  });

  it('falls back to stdout when output file is missing', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      // Don't write output file — return stdout
      return 'stdout feedback';
    });

    const result = await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('stdout feedback');
  });

  it('throws CodexBackendError when codex not found in PATH', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') throw new Error('not found');
      return '';
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/codex CLI not found/);
  });

  it('throws on non-zero exit code with stderr', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      const err = new Error('command failed') as Error & {
        status: number;
        stdout: Buffer;
        stderr: Buffer;
      };
      err.status = 2;
      err.stdout = Buffer.from('');
      err.stderr = Buffer.from('codex failed');
      throw err;
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow('codex failed');
  });

  it('throws on timeout', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
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

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 10,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('throws when codex produces no output', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      // No output file, empty stdout
      return '';
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/without producing feedback/);
  });

  it('throws on output file read failure (OSError parity)', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      // Write a directory where the output file should be, causing read failure
      const outputIdx = args.indexOf('--output-last-message') + 1;
      if (outputIdx > 0) {
        fs.mkdirSync(args[outputIdx], { recursive: true });
      }
      return '';
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/Failed reading Codex output file/);
  });

  // --- review() method ---

  describe('review()', () => {
    const baseReviewOpts: ReviewOptions = {
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxModeType,
      model: null,
      env: {},
      base: 'main',
    };

    it('builds correct codex exec review --base main args', async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        const outputIdx = args.indexOf('--output-last-message') + 1;
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'Review feedback');
        return '';
      });

      const result = await CODEX_BACKEND.review!(baseReviewOpts);
      expect(result).toBe('Review feedback');

      const codexCall = mockExecFileSync.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      expect(codexCall).toBeDefined();
      const args = codexCall![1] as string[];
      expect(args[0]).toBe('exec');
      expect(args[1]).toBe('review');
      expect(args).toContain('-C');
      expect(args).toContain('/tmp/repo');
      expect(args).toContain('--base');
      expect(args[args.indexOf('--base') + 1]).toBe('main');
      expect(args).toContain('--sandbox');
      expect(args).toContain('read-only');
      expect(args).toContain('--output-last-message');
    });

    it('passes custom prompt as positional arg', async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        const outputIdx = args.indexOf('--output-last-message') + 1;
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
        return '';
      });

      await CODEX_BACKEND.review!({
        ...baseReviewOpts,
        prompt: 'Focus on security issues',
      });

      const codexCall = mockExecFileSync.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      const args = codexCall![1] as string[];
      expect(args[args.length - 1]).toBe('Focus on security issues');
    });

    it('passes -m when model is set', async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        const outputIdx = args.indexOf('--output-last-message') + 1;
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
        return '';
      });

      await CODEX_BACKEND.review!({ ...baseReviewOpts, model: 'o3' });

      const codexCall = mockExecFileSync.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      const args = codexCall![1] as string[];
      const modelIdx = args.indexOf('-m');
      expect(modelIdx).toBeGreaterThan(-1);
      expect(args[modelIdx + 1]).toBe('o3');
    });

    it('throws on timeout', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
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

      await expect(
        CODEX_BACKEND.review!(baseReviewOpts),
      ).rejects.toThrow(/codex exec review timed out/);
    });

    it('throws when codex not found in PATH', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') throw new Error('not found');
        return '';
      });

      await expect(
        CODEX_BACKEND.review!(baseReviewOpts),
      ).rejects.toThrow(/codex CLI not found/);
    });

    it('does not include prompt arg when prompt is undefined', async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        const outputIdx = args.indexOf('--output-last-message') + 1;
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
        return '';
      });

      await CODEX_BACKEND.review!(baseReviewOpts);

      const codexCall = mockExecFileSync.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      const args = codexCall![1] as string[];
      // Last arg should be the output path value, not a prompt
      expect(args[args.length - 1]).not.toBe('main'); // base value
      // The args should not contain any extra positional arg beyond flags
      const outputIdx = args.indexOf('--output-last-message');
      expect(outputIdx).toBeGreaterThan(-1);
    });
  });
});

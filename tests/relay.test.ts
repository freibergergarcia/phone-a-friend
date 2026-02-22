import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SandboxMode, Backend } from '../src/backends/index.js';

// Mock child_process for git diff calls
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync };
});

import {
  relay,
  RelayError,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_BACKEND,
  DEFAULT_SANDBOX,
  MAX_CONTEXT_FILE_BYTES,
  MAX_DIFF_BYTES,
  MAX_PROMPT_BYTES,
  MAX_RELAY_DEPTH,
} from '../src/relay.js';
import { registerBackend, _resetRegistry } from '../src/backends/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phone-a-friend-test-'));
}

function makeMockBackend(name: string): Backend {
  return {
    name,
    allowedSandboxes: new Set<SandboxMode>(['read-only', 'workspace-write', 'danger-full-access']),
    run: vi.fn(() => 'mock feedback'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('relay constants', () => {
  it('exports expected defaults', () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(600);
    expect(DEFAULT_BACKEND).toBe('codex');
    expect(DEFAULT_SANDBOX).toBe('read-only');
    expect(MAX_RELAY_DEPTH).toBe(1);
    expect(MAX_CONTEXT_FILE_BYTES).toBe(200_000);
    expect(MAX_DIFF_BYTES).toBe(300_000);
    expect(MAX_PROMPT_BYTES).toBe(500_000);
  });
});

describe('relay', () => {
  let repo: string;
  let mockBackend: Backend;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    _resetRegistry();
    repo = makeTempDir();
    mockBackend = makeMockBackend('codex');
    registerBackend(mockBackend);
    registerBackend(makeMockBackend('gemini'));
    // Reset depth env
    process.env.PHONE_A_FRIEND_DEPTH = '0';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  it('calls backend with correct args and returns result', () => {
    const result = relay({
      prompt: 'Review the latest implementation.',
      repoPath: repo,
    });

    expect(result).toBe('mock feedback');
    expect(mockBackend.run).toHaveBeenCalledOnce();
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Review the latest implementation.');
    expect(callArgs.repoPath).toBe(repo);
    expect(callArgs.sandbox).toBe('read-only');
    expect(callArgs.model).toBeNull();
  });

  it('uses default backend (codex)', () => {
    relay({ prompt: 'Review', repoPath: repo });
    expect(mockBackend.run).toHaveBeenCalledOnce();
  });

  it('uses default sandbox (read-only)', () => {
    relay({ prompt: 'Review', repoPath: repo });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sandbox).toBe('read-only');
  });

  it('passes custom sandbox', () => {
    relay({ prompt: 'Review', repoPath: repo, sandbox: 'workspace-write' });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sandbox).toBe('workspace-write');
  });

  it('passes model when provided', () => {
    relay({ prompt: 'Review', repoPath: repo, model: 'o3' });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe('o3');
  });

  it('passes timeout', () => {
    relay({ prompt: 'Review', repoPath: repo, timeoutSeconds: 120 });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.timeoutSeconds).toBe(120);
  });

  // --- Prompt building ---

  it('includes context text in prompt', () => {
    relay({ prompt: 'Review', repoPath: repo, contextText: 'This is inline context.' });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Additional Context:');
    expect(callArgs.prompt).toContain('This is inline context.');
  });

  it('includes context file in prompt', () => {
    const contextPath = path.join(repo, 'context.md');
    fs.writeFileSync(contextPath, 'File-based context content');

    relay({ prompt: 'Review', repoPath: repo, contextFile: contextPath });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Additional Context:');
    expect(callArgs.prompt).toContain('File-based context content');
  });

  it('includes git diff in prompt when include_diff is true', () => {
    // Mock git diff call
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/bin/git';
      if (cmd === 'git') return 'diff --git a/a.py b/a.py';
      return '';
    });

    relay({ prompt: 'Review this diff.', repoPath: repo, includeDiff: true });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Git Diff:');
    expect(callArgs.prompt).toContain('diff --git a/a.py b/a.py');
  });

  // --- Error cases ---

  it('raises on empty prompt', () => {
    expect(() => relay({ prompt: '   ', repoPath: repo })).toThrow(RelayError);
    expect(() => relay({ prompt: '   ', repoPath: repo })).toThrow('Prompt is required');
  });

  it('raises on missing repo path', () => {
    const missingRepo = path.join(os.tmpdir(), `phone-a-friend-missing-${Date.now()}`);
    expect(() => relay({ prompt: 'test', repoPath: missingRepo })).toThrow(RelayError);
    expect(() => relay({ prompt: 'test', repoPath: missingRepo })).toThrow(
      'Repository path does not exist',
    );
  });

  it('raises on zero timeout', () => {
    expect(() => relay({ prompt: 'test', repoPath: repo, timeoutSeconds: 0 })).toThrow(
      'Timeout must be greater than zero',
    );
  });

  it('raises on unsupported backend', () => {
    expect(() =>
      relay({ prompt: 'Review', repoPath: repo, backend: 'unknown' }),
    ).toThrow(/Unsupported relay backend/);
  });

  it('raises on invalid sandbox mode', () => {
    expect(() =>
      relay({
        prompt: 'Review',
        repoPath: repo,
        sandbox: 'totally-unsafe' as SandboxMode,
      }),
    ).toThrow(/Invalid sandbox mode/);
  });

  it('raises when context file does not exist', () => {
    const missingContext = path.join(repo, 'missing.md');
    expect(() =>
      relay({ prompt: 'Review', repoPath: repo, contextFile: missingContext }),
    ).toThrow('Context file does not exist');
  });

  it('raises when context path is a directory', () => {
    const ctxDir = path.join(repo, 'ctx');
    fs.mkdirSync(ctxDir);
    expect(() =>
      relay({ prompt: 'Review', repoPath: repo, contextFile: ctxDir }),
    ).toThrow('Context path is not a file');
  });

  it('raises when both context_file and context_text are provided', () => {
    const contextPath = path.join(repo, 'context.md');
    fs.writeFileSync(contextPath, 'from file');

    expect(() =>
      relay({
        prompt: 'Review',
        repoPath: repo,
        contextFile: contextPath,
        contextText: 'from inline',
      }),
    ).toThrow('either context_file or context_text');
  });

  // --- Size limits ---

  it('raises when context text exceeds size limit', () => {
    const bigContext = 'a'.repeat(200_001);
    expect(() =>
      relay({ prompt: 'Review', repoPath: repo, contextText: bigContext }),
    ).toThrow(/too large/);
  });

  it('accepts context text at exactly the size limit', () => {
    const context = 'a'.repeat(200_000);
    relay({ prompt: 'Review', repoPath: repo, contextText: context });
    expect(mockBackend.run).toHaveBeenCalledOnce();
  });

  it('raises when full prompt exceeds size limit', () => {
    const bigPrompt = 'a'.repeat(500_001);
    expect(() => relay({ prompt: bigPrompt, repoPath: repo })).toThrow(/too large/);
  });

  it('raises when git diff exceeds size limit', () => {
    const bigDiff = 'a'.repeat(300_001);
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/bin/git';
      if (cmd === 'git') return bigDiff;
      return '';
    });

    expect(() =>
      relay({ prompt: 'Review', repoPath: repo, includeDiff: true }),
    ).toThrow(/too large/);
  });

  // --- Depth guard ---

  it('raises when relay depth limit is reached', () => {
    process.env.PHONE_A_FRIEND_DEPTH = '1';
    expect(() => relay({ prompt: 'Review', repoPath: repo })).toThrow(
      'Relay depth limit reached',
    );
    // Backend should NOT have been called
    expect(mockBackend.run).not.toHaveBeenCalled();
  });

  it('increments depth in env passed to backend', () => {
    process.env.PHONE_A_FRIEND_DEPTH = '0';
    relay({ prompt: 'Review', repoPath: repo });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.env.PHONE_A_FRIEND_DEPTH).toBe('1');
  });

  it('handles non-numeric depth gracefully', () => {
    process.env.PHONE_A_FRIEND_DEPTH = 'garbage';
    // Should treat as 0, not throw
    relay({ prompt: 'Review', repoPath: repo });
    expect(mockBackend.run).toHaveBeenCalledOnce();
  });

  // --- Git diff errors ---

  it('raises on git diff failure', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/bin/git';
      if (cmd === 'git') {
        const err = new Error('not a git repository') as Error & {
          status: number;
          stdout: Buffer;
          stderr: Buffer;
        };
        err.status = 1;
        err.stdout = Buffer.from('');
        err.stderr = Buffer.from('not a git repository');
        throw err;
      }
      return '';
    });

    expect(() =>
      relay({ prompt: 'Review', repoPath: repo, includeDiff: true }),
    ).toThrow('Failed to collect git diff');
  });

  // --- Backend error wrapping ---

  it('wraps backend errors as RelayError', () => {
    const failingBackend = makeMockBackend('codex');
    (failingBackend.run as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('codex exploded');
    });
    _resetRegistry();
    registerBackend(failingBackend);

    expect(() => relay({ prompt: 'Review', repoPath: repo })).toThrow(RelayError);
    expect(() => {
      _resetRegistry();
      registerBackend(failingBackend);
      relay({ prompt: 'Review', repoPath: repo });
    }).toThrow('codex exploded');
  });

  // --- Stdout fallback (codex specific, tested via relay) ---

  it('returns backend output directly', () => {
    (mockBackend.run as ReturnType<typeof vi.fn>).mockReturnValue('Direct feedback');
    const result = relay({ prompt: 'Review', repoPath: repo });
    expect(result).toBe('Direct feedback');
  });
});

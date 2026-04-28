import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BackendError, type BackendCapabilities, type SandboxMode, type Backend } from '../src/backends/index.js';
import { SessionStore } from '../src/sessions.js';

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
  reviewRelay,
  detectDefaultBranch,
  gitDiffBase,
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
import type { ReviewOptions } from '../src/backends/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phone-a-friend-test-'));
}

const DEFAULT_CAPABILITIES: BackendCapabilities = {
  resumeStrategy: 'transcript-replay',
  requiresClientSessionId: false,
};

function makeMockBackend(name: string): Backend {
  return {
    name,
    localFileAccess: true,
    allowedSandboxes: new Set<SandboxMode>(['read-only', 'workspace-write', 'danger-full-access']),
    capabilities: DEFAULT_CAPABILITIES,
    run: vi.fn(async () => 'mock feedback'),
  };
}

function makeMockBackendWithReview(name: string): Backend & { review: ReturnType<typeof vi.fn> } {
  return {
    name,
    localFileAccess: true,
    allowedSandboxes: new Set<SandboxMode>(['read-only', 'workspace-write', 'danger-full-access']),
    capabilities: DEFAULT_CAPABILITIES,
    run: vi.fn(async () => 'mock feedback'),
    review: vi.fn(async () => 'mock review feedback'),
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

  it('calls backend with correct args and returns result', async () => {
    const result = await relay({
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

  it('uses default backend (codex)', async () => {
    await relay({ prompt: 'Review', repoPath: repo });
    expect(mockBackend.run).toHaveBeenCalledOnce();
  });

  it('uses default sandbox (read-only)', async () => {
    await relay({ prompt: 'Review', repoPath: repo });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sandbox).toBe('read-only');
  });

  it('passes custom sandbox', async () => {
    await relay({ prompt: 'Review', repoPath: repo, sandbox: 'workspace-write' });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sandbox).toBe('workspace-write');
  });

  it('passes model when provided', async () => {
    await relay({ prompt: 'Review', repoPath: repo, model: 'o3' });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe('o3');
  });

  it('passes timeout', async () => {
    await relay({ prompt: 'Review', repoPath: repo, timeoutSeconds: 120 });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.timeoutSeconds).toBe(120);
  });

  it('passes schema through to backend', async () => {
    await relay({ prompt: 'Review', repoPath: repo, schema: '{"type":"object"}' });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.schema).toBe('{"type":"object"}');
  });

  it('passes fast through to backend', async () => {
    await relay({ prompt: 'Review', repoPath: repo, fast: true });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.fast).toBe(true);
  });

  it('persists relay session history and backend session id', async () => {
    const sessionStore = new SessionStore(path.join(repo, 'sessions.json'));
    (mockBackend.run as ReturnType<typeof vi.fn>).mockImplementation(async (opts) => {
      opts.onSessionCreated?.('backend-session-1');
      return 'first reply';
    });

    await relay({
      prompt: 'Review',
      repoPath: repo,
      session: 'codex-review',
      sessionStore,
    });

    const session = sessionStore.get('codex-review');
    expect(session?.backend).toBe('codex');
    expect(session?.backendSessionId).toBe('backend-session-1');
    expect(session?.history).toEqual([
      { role: 'user', content: expect.stringContaining('Request:\nReview') },
      { role: 'assistant', content: 'first reply' },
    ]);
  });

  it('resumes an existing session with stored history and native session id', async () => {
    const sessionStore = new SessionStore(path.join(repo, 'sessions.json'));
    sessionStore.upsert({
      id: 'codex-review',
      backend: 'codex',
      repoPath: repo,
      backendSessionId: 'thread-123',
      historyAppend: [
        { role: 'user', content: 'old prompt' },
        { role: 'assistant', content: 'old reply' },
      ],
    });

    await relay({
      prompt: 'Follow up',
      repoPath: repo,
      session: 'codex-review',
      sessionStore,
    });

    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sessionId).toBe('thread-123');
    expect(callArgs.persistSession).toBe(true);
    expect(callArgs.resumeSession).toBe(true);
    expect(callArgs.sessionHistory).toEqual([
      { role: 'user', content: 'old prompt' },
      { role: 'assistant', content: 'old reply' },
    ]);
  });

  // --- Prompt building ---

  it('includes context text in prompt', async () => {
    await relay({ prompt: 'Review', repoPath: repo, contextText: 'This is inline context.' });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Additional Context:');
    expect(callArgs.prompt).toContain('This is inline context.');
  });

  it('includes context file in prompt', async () => {
    const contextPath = path.join(repo, 'context.md');
    fs.writeFileSync(contextPath, 'File-based context content');

    await relay({ prompt: 'Review', repoPath: repo, contextFile: contextPath });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Additional Context:');
    expect(callArgs.prompt).toContain('File-based context content');
  });

  it('includes git diff in prompt when include_diff is true', async () => {
    // Mock git diff HEAD -- returning content (uncommitted changes)
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.includes('HEAD')) {
        return 'diff --git a/a.py b/a.py';
      }
      return '';
    });

    await relay({ prompt: 'Review this diff.', repoPath: repo, includeDiff: true });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Git Diff:');
    expect(callArgs.prompt).toContain('diff --git a/a.py b/a.py');
  });

  it('falls back to HEAD~1 diff when working tree is clean', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      // git diff HEAD -- returns empty (no uncommitted changes)
      if (args.includes('diff') && args.includes('HEAD') && !args.includes('HEAD~1')) {
        return '';
      }
      // git diff HEAD~1 HEAD -- returns last commit diff
      if (args.includes('diff') && args.includes('HEAD~1')) {
        return 'diff --git a/b.ts b/b.ts\n+committed line';
      }
      return '';
    });

    await relay({ prompt: 'What changed?', repoPath: repo, includeDiff: true });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Git Diff:');
    expect(callArgs.prompt).toContain('diff --git a/b.ts b/b.ts');
    expect(callArgs.prompt).toContain('+committed line');
  });

  it('returns empty when both HEAD and HEAD~1 diffs are empty', async () => {
    mockExecFileSync.mockReturnValue('');

    await relay({ prompt: 'Check diff', repoPath: repo, includeDiff: true });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).not.toContain('Git Diff:');
  });

  it('handles HEAD~1 failure gracefully (e.g. single-commit repo)', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      // git diff HEAD -- returns empty
      if (args.includes('diff') && args.includes('HEAD') && !args.includes('HEAD~1')) {
        return '';
      }
      // git diff HEAD~1 HEAD -- fails (no parent commit)
      if (args.includes('diff') && args.includes('HEAD~1')) {
        throw new Error('fatal: bad revision HEAD~1');
      }
      return '';
    });

    await relay({ prompt: 'Check diff', repoPath: repo, includeDiff: true });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Should proceed without diff, not throw
    expect(callArgs.prompt).not.toContain('Git Diff:');
  });

  it('propagates size limit error from diff source', async () => {
    const bigDiff = 'a'.repeat(300_001);
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.includes('HEAD')) {
        return bigDiff;
      }
      return '';
    });

    await expect(
      relay({ prompt: 'Review', repoPath: repo, includeDiff: true }),
    ).rejects.toThrow(/too large/);
  });

  // --- Error cases ---

  it('raises on empty prompt', async () => {
    await expect(relay({ prompt: '   ', repoPath: repo })).rejects.toThrow(RelayError);
    await expect(relay({ prompt: '   ', repoPath: repo })).rejects.toThrow('Prompt is required');
  });

  it('raises on missing repo path', async () => {
    const missingRepo = path.join(os.tmpdir(), `phone-a-friend-missing-${Date.now()}`);
    await expect(relay({ prompt: 'test', repoPath: missingRepo })).rejects.toThrow(RelayError);
    await expect(relay({ prompt: 'test', repoPath: missingRepo })).rejects.toThrow(
      'Repository path does not exist',
    );
  });

  it('raises on zero timeout', async () => {
    await expect(relay({ prompt: 'test', repoPath: repo, timeoutSeconds: 0 })).rejects.toThrow(
      'Timeout must be greater than zero',
    );
  });

  it('raises on unsupported backend', async () => {
    await expect(
      relay({ prompt: 'Review', repoPath: repo, backend: 'unknown' }),
    ).rejects.toThrow(/Unsupported relay backend/);
  });

  it('raises on invalid sandbox mode', async () => {
    await expect(
      relay({
        prompt: 'Review',
        repoPath: repo,
        sandbox: 'totally-unsafe' as SandboxMode,
      }),
    ).rejects.toThrow(/Invalid sandbox mode/);
  });

  it('raises when context file does not exist', async () => {
    const missingContext = path.join(repo, 'missing.md');
    await expect(
      relay({ prompt: 'Review', repoPath: repo, contextFile: missingContext }),
    ).rejects.toThrow('Context file does not exist');
  });

  it('raises when context path is a directory', async () => {
    const ctxDir = path.join(repo, 'ctx');
    fs.mkdirSync(ctxDir);
    await expect(
      relay({ prompt: 'Review', repoPath: repo, contextFile: ctxDir }),
    ).rejects.toThrow('Context path is not a file');
  });

  it('raises when both context_file and context_text are provided', async () => {
    const contextPath = path.join(repo, 'context.md');
    fs.writeFileSync(contextPath, 'from file');

    await expect(
      relay({
        prompt: 'Review',
        repoPath: repo,
        contextFile: contextPath,
        contextText: 'from inline',
      }),
    ).rejects.toThrow('either context_file or context_text');
  });

  // --- Size limits ---

  it('raises when context text exceeds size limit', async () => {
    const bigContext = 'a'.repeat(200_001);
    await expect(
      relay({ prompt: 'Review', repoPath: repo, contextText: bigContext }),
    ).rejects.toThrow(/too large/);
  });

  it('accepts context text at exactly the size limit', async () => {
    const context = 'a'.repeat(200_000);
    await relay({ prompt: 'Review', repoPath: repo, contextText: context });
    expect(mockBackend.run).toHaveBeenCalledOnce();
  });

  it('raises when full prompt exceeds size limit', async () => {
    const bigPrompt = 'a'.repeat(500_001);
    await expect(relay({ prompt: bigPrompt, repoPath: repo })).rejects.toThrow(/too large/);
  });

  it('raises when git diff exceeds size limit', async () => {
    const bigDiff = 'a'.repeat(300_001);
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.includes('HEAD')) return bigDiff;
      return '';
    });

    await expect(
      relay({ prompt: 'Review', repoPath: repo, includeDiff: true }),
    ).rejects.toThrow(/too large/);
  });

  // --- Depth guard ---

  it('raises when relay depth limit is reached', async () => {
    process.env.PHONE_A_FRIEND_DEPTH = '1';
    await expect(relay({ prompt: 'Review', repoPath: repo })).rejects.toThrow(
      'Relay depth limit reached',
    );
    // Backend should NOT have been called
    expect(mockBackend.run).not.toHaveBeenCalled();
  });

  it('increments depth in env passed to backend', async () => {
    process.env.PHONE_A_FRIEND_DEPTH = '0';
    await relay({ prompt: 'Review', repoPath: repo });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.env.PHONE_A_FRIEND_DEPTH).toBe('1');
  });

  it('handles non-numeric depth gracefully', async () => {
    process.env.PHONE_A_FRIEND_DEPTH = 'garbage';
    // Should treat as 0, not throw
    await relay({ prompt: 'Review', repoPath: repo });
    expect(mockBackend.run).toHaveBeenCalledOnce();
  });

  it('treats partial numeric depth "1abc" as 0 (matches Python int())', async () => {
    process.env.PHONE_A_FRIEND_DEPTH = '1abc';
    // Python int("1abc") raises ValueError, falls to 0. We should too.
    await relay({ prompt: 'Review', repoPath: repo });
    expect(mockBackend.run).toHaveBeenCalledOnce();
  });

  // --- Git diff errors ---

  it('treats git diff failure as empty diff (does not throw)', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
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

    // Should not throw — git failure is treated as empty diff
    await relay({ prompt: 'Review', repoPath: repo, includeDiff: true });
    const callArgs = (mockBackend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).not.toContain('Git Diff:');
  });

  // --- Backend error wrapping ---

  it('wraps BackendError as RelayError', async () => {
    const failingBackend = makeMockBackend('codex');
    (failingBackend.run as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BackendError('codex exploded'),
    );
    _resetRegistry();
    registerBackend(failingBackend);

    await expect(relay({ prompt: 'Review', repoPath: repo })).rejects.toThrow(RelayError);
    await expect(relay({ prompt: 'Review', repoPath: repo })).rejects.toThrow('codex exploded');
  });

  it('lets unexpected (non-BackendError) errors propagate unwrapped', async () => {
    const failingBackend = makeMockBackend('codex');
    (failingBackend.run as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('unexpected bug'),
    );
    _resetRegistry();
    registerBackend(failingBackend);

    await expect(relay({ prompt: 'Review', repoPath: repo })).rejects.toThrow(TypeError);
    await expect(relay({ prompt: 'Review', repoPath: repo })).rejects.toThrow('unexpected bug');
  });

  // --- Backend dispatch ---

  it('dispatches to gemini backend when specified', async () => {
    const geminiBackend = makeMockBackend('gemini');
    (geminiBackend.run as ReturnType<typeof vi.fn>).mockResolvedValue('Gemini says hi');
    _resetRegistry();
    registerBackend(mockBackend);
    registerBackend(geminiBackend);

    const result = await relay({ prompt: 'Hello Gemini', repoPath: repo, backend: 'gemini' });
    expect(result).toBe('Gemini says hi');
    expect(geminiBackend.run).toHaveBeenCalledOnce();
    expect(mockBackend.run).not.toHaveBeenCalled();
  });

  it('returns backend output directly', async () => {
    (mockBackend.run as ReturnType<typeof vi.fn>).mockResolvedValue('Direct feedback');
    const result = await relay({ prompt: 'Review', repoPath: repo });
    expect(result).toBe('Direct feedback');
  });
});

// ---------------------------------------------------------------------------
// detectDefaultBranch
// ---------------------------------------------------------------------------

describe('detectDefaultBranch', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns main when main exists', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('main')) return 'sha\n';
      throw new Error('not found');
    });

    expect(detectDefaultBranch('/tmp/repo')).toBe('main');
  });

  it('returns master when main does not exist but master does', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('main')) throw new Error('not found');
      if (args.includes('master')) return 'sha\n';
      throw new Error('not found');
    });

    expect(detectDefaultBranch('/tmp/repo')).toBe('master');
  });

  it('returns HEAD~1 when neither main nor master exist', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(detectDefaultBranch('/tmp/repo')).toBe('HEAD~1');
  });
});

// ---------------------------------------------------------------------------
// gitDiffBase
// ---------------------------------------------------------------------------

describe('gitDiffBase', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls git diff with correct base...HEAD args', () => {
    mockExecFileSync.mockReturnValue('diff output');

    const result = gitDiffBase('/tmp/repo', 'main');
    expect(result).toBe('diff output');

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/tmp/repo', 'diff', 'main...HEAD', '--'],
      expect.any(Object),
    );
  });

  it('throws RelayError when diff exceeds size limit', () => {
    const bigDiff = 'a'.repeat(300_001);
    mockExecFileSync.mockReturnValue(bigDiff);

    expect(() => gitDiffBase('/tmp/repo', 'main')).toThrow(/too large/);
  });

  it('throws RelayError on git failure', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('failed') as Error & {
        status: number;
        stderr: Buffer;
        stdout: Buffer;
      };
      err.status = 1;
      err.stderr = Buffer.from('fatal: bad revision');
      err.stdout = Buffer.from('');
      throw err;
    });

    expect(() => gitDiffBase('/tmp/repo', 'develop')).toThrow(
      /Failed to collect git diff against develop/,
    );
  });
});

// ---------------------------------------------------------------------------
// reviewRelay
// ---------------------------------------------------------------------------

describe('reviewRelay', () => {
  let repo: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    _resetRegistry();
    repo = makeTempDir();
    process.env.PHONE_A_FRIEND_DEPTH = '0';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  it('calls backend.review() when available and no custom prompt', async () => {
    const backend = makeMockBackendWithReview('codex');
    registerBackend(backend);

    const result = await reviewRelay({
      repoPath: repo,
      backend: 'codex',
      base: 'main',
    });

    expect(result).toBe('mock review feedback');
    expect(backend.review).toHaveBeenCalledOnce();
    expect(backend.run).not.toHaveBeenCalled();

    const callArgs = backend.review.mock.calls[0][0] as ReviewOptions;
    expect(callArgs.base).toBe('main');
    expect(callArgs.repoPath).toBe(repo);
  });

  it('skips backend.review() and uses run() when custom prompt is provided', async () => {
    const backend = makeMockBackendWithReview('codex');
    registerBackend(backend);

    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.some((a: string) => a.includes('...'))) {
        return 'diff --git a/file.ts b/file.ts';
      }
      return '';
    });

    const result = await reviewRelay({
      repoPath: repo,
      backend: 'codex',
      base: 'main',
      prompt: 'Check for bugs',
    });

    expect(result).toBe('mock feedback');
    expect(backend.review).not.toHaveBeenCalled();
    expect(backend.run).toHaveBeenCalledOnce();
    const callArgs = (backend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Check for bugs');
    expect(callArgs.prompt).toContain('Git Diff:');
  });

  it('falls back to run() with diff when review() is not available', async () => {
    const backend = makeMockBackend('gemini');
    registerBackend(backend);

    // Mock git for detectDefaultBranch + gitDiffBase
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      // detectDefaultBranch won't be called since we provide base explicitly
      // gitDiffBase
      if (args.includes('diff') && args.some((a: string) => a.includes('...'))) {
        return 'diff --git a/file.ts b/file.ts\n+added line';
      }
      return '';
    });

    const result = await reviewRelay({
      repoPath: repo,
      backend: 'gemini',
      base: 'main',
      prompt: 'Review changes',
    });

    expect(result).toBe('mock feedback');
    expect(backend.run).toHaveBeenCalledOnce();
    const callArgs = (backend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Git Diff:');
    expect(callArgs.prompt).toContain('diff --git');
  });

  it('falls back to run() when review() throws', async () => {
    const backend = makeMockBackendWithReview('codex');
    backend.review.mockRejectedValue(new Error('codex exec review not supported'));
    registerBackend(backend);

    // Mock git for gitDiffBase fallback
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.some((a: string) => a.includes('...'))) {
        return 'diff content here';
      }
      return '';
    });

    // Suppress the console.error warning
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await reviewRelay({
      repoPath: repo,
      backend: 'codex',
      base: 'main',
    });

    expect(result).toBe('mock feedback');
    expect(backend.review).toHaveBeenCalledOnce();
    expect(backend.run).toHaveBeenCalledOnce();
    expect(consoleErr).toHaveBeenCalledWith(
      expect.stringContaining('review() failed, falling back'),
    );
  });

  it('auto-detects base branch when not provided', async () => {
    const backend = makeMockBackendWithReview('codex');
    registerBackend(backend);

    // Mock git rev-parse --verify main to succeed
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('main')) return 'sha\n';
      throw new Error('not found');
    });

    await reviewRelay({ repoPath: repo, backend: 'codex' });

    const callArgs = backend.review.mock.calls[0][0] as ReviewOptions;
    expect(callArgs.base).toBe('main');
  });

  it('uses default prompt when none provided (generic path)', async () => {
    const backend = makeMockBackend('gemini');
    registerBackend(backend);

    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.some((a: string) => a.includes('...'))) {
        return 'some diff';
      }
      return '';
    });

    await reviewRelay({ repoPath: repo, backend: 'gemini', base: 'main' });

    const callArgs = (backend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain('Review the following changes.');
  });

  it('respects depth guard', async () => {
    const backend = makeMockBackendWithReview('codex');
    registerBackend(backend);

    process.env.PHONE_A_FRIEND_DEPTH = '1';
    await expect(
      reviewRelay({ repoPath: repo, backend: 'codex', base: 'main' }),
    ).rejects.toThrow('Relay depth limit reached');
  });

  it('raises on missing repo path', async () => {
    const backend = makeMockBackendWithReview('codex');
    registerBackend(backend);

    const missingRepo = path.join(os.tmpdir(), `phone-a-friend-missing-${Date.now()}`);
    await expect(
      reviewRelay({ repoPath: missingRepo, backend: 'codex', base: 'main' }),
    ).rejects.toThrow('Repository path does not exist');
  });

  it('raises on zero timeout', async () => {
    const backend = makeMockBackendWithReview('codex');
    registerBackend(backend);

    await expect(
      reviewRelay({ repoPath: repo, backend: 'codex', base: 'main', timeoutSeconds: 0 }),
    ).rejects.toThrow('Timeout must be greater than zero');
  });
});

// ---------------------------------------------------------------------------
// --backend-session and unknown-label warning
// ---------------------------------------------------------------------------

function makeNativeSessionBackend(name: string): Backend {
  return {
    name,
    localFileAccess: true,
    allowedSandboxes: new Set<SandboxMode>(['read-only', 'workspace-write', 'danger-full-access']),
    capabilities: {
      resumeStrategy: 'native-session',
      requiresClientSessionId: false,
    },
    run: vi.fn(async () => 'attached reply'),
  };
}

describe('relay with --backend-session', () => {
  let repo: string;
  let backend: Backend;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    _resetRegistry();
    repo = makeTempDir();
    backend = makeNativeSessionBackend('codex');
    registerBackend(backend);
    registerBackend(makeMockBackend('gemini')); // transcript-replay
    process.env.PHONE_A_FRIEND_DEPTH = '0';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  it('passes the raw backend session id and resumes without writing the label store', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));

    const result = await relay({
      prompt: 'follow up',
      repoPath: repo,
      backendSession: 'thread-abc',
      sessionStore: store,
    });

    expect(result).toBe('attached reply');
    const callArgs = (backend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sessionId).toBe('thread-abc');
    expect(callArgs.resumeSession).toBe(true);
    expect(callArgs.persistSession).toBe(false);
    expect(store.list()).toHaveLength(0);
  });

  it('rejects when backend does not support native session resume', async () => {
    await expect(
      relay({
        prompt: 'follow up',
        repoPath: repo,
        backend: 'gemini',
        backendSession: 'thread-abc',
      }),
    ).rejects.toThrow(/--backend-session is not supported/);
  });

  it('adopts a backend session under a new PaF label and persists it', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));

    await relay({
      prompt: 'follow up',
      repoPath: repo,
      session: 'adopt-me',
      backendSession: 'thread-abc',
      sessionStore: store,
    });

    const callArgs = (backend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sessionId).toBe('thread-abc');
    expect(callArgs.resumeSession).toBe(true);
    expect(callArgs.persistSession).toBe(true);

    const saved = store.get('adopt-me');
    expect(saved?.backend).toBe('codex');
    expect(saved?.backendSessionId).toBe('thread-abc');
    expect(saved?.repoPath).toBe(repo);
    expect(saved?.history).toHaveLength(2);
  });

  it('is idempotent when the label already points at the same backend session and repo', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));
    store.upsert({
      id: 'adopt-me',
      backend: 'codex',
      repoPath: repo,
      backendSessionId: 'thread-abc',
      historyAppend: [
        { role: 'user', content: 'old prompt' },
        { role: 'assistant', content: 'old reply' },
      ],
    });

    await relay({
      prompt: 'follow up',
      repoPath: repo,
      session: 'adopt-me',
      backendSession: 'thread-abc',
      sessionStore: store,
    });

    const callArgs = (backend.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.sessionId).toBe('thread-abc');
    expect(callArgs.sessionHistory).toHaveLength(2);

    const saved = store.get('adopt-me');
    expect(saved?.history).toHaveLength(4);
  });

  it('errors when the existing label points at a different backend session id', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));
    store.upsert({
      id: 'adopt-me',
      backend: 'codex',
      repoPath: repo,
      backendSessionId: 'thread-OTHER',
    });

    await expect(
      relay({
        prompt: 'follow up',
        repoPath: repo,
        session: 'adopt-me',
        backendSession: 'thread-abc',
        sessionStore: store,
      }),
    ).rejects.toThrow(/conflicting metadata/);
  });

  it('errors when the existing label belongs to a different backend', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));
    store.upsert({
      id: 'adopt-me',
      backend: 'gemini',
      repoPath: repo,
      backendSessionId: 'thread-abc',
    });

    await expect(
      relay({
        prompt: 'follow up',
        repoPath: repo,
        session: 'adopt-me',
        backendSession: 'thread-abc',
        sessionStore: store,
      }),
    ).rejects.toThrow(/conflicting metadata/);
  });

  it('errors when the existing label was used in a different repo', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));
    store.upsert({
      id: 'adopt-me',
      backend: 'codex',
      repoPath: '/some/other/repo',
      backendSessionId: 'thread-abc',
    });

    await expect(
      relay({
        prompt: 'follow up',
        repoPath: repo,
        session: 'adopt-me',
        backendSession: 'thread-abc',
        sessionStore: store,
      }),
    ).rejects.toThrow(/conflicting metadata/);
  });
});

describe('relay --session warning on unknown label', () => {
  let repo: string;
  let backend: Backend;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    _resetRegistry();
    repo = makeTempDir();
    backend = makeNativeSessionBackend('codex');
    registerBackend(backend);
    process.env.PHONE_A_FRIEND_DEPTH = '0';
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  it('warns when --session label is not in the store', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));
    await relay({
      prompt: 'first call',
      repoPath: repo,
      session: 'fresh-label',
      sessionStore: store,
    });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const message = stderrSpy.mock.calls[0][0] as string;
    expect(message).toContain('Session label "fresh-label" not found');
    expect(message).toContain('--backend-session');
  });

  it('does not warn when the label already exists in the store', async () => {
    const store = new SessionStore(path.join(repo, 'sessions.json'));
    store.upsert({
      id: 'known-label',
      backend: 'codex',
      repoPath: repo,
      backendSessionId: 'thread-xyz',
    });

    await relay({
      prompt: 'follow up',
      repoPath: repo,
      session: 'known-label',
      sessionStore: store,
    });

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('does not warn when neither --session nor --backend-session is set', async () => {
    await relay({ prompt: 'one-shot', repoPath: repo });
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

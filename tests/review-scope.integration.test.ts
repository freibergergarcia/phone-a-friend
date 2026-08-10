import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_DIFF_BYTES, reviewRelay } from '../src/relay.js';
import {
  _resetRegistry,
  registerBackend,
  type Backend,
  type BackendRunOptions,
} from '../src/backends/index.js';

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(repo: string, relativePath: string, contents: string): void {
  writeFileSync(join(repo, relativePath), contents);
}

describe('review scopes with a real Git repository', () => {
  let repo: string;
  let run: ReturnType<typeof vi.fn<(opts: BackendRunOptions) => Promise<string>>>;
  const originalDepth = process.env.PHONE_A_FRIEND_DEPTH;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'paf-review-scope-'));
    git(repo, ['init', '--initial-branch=main']);
    git(repo, ['config', 'user.email', 'paf-tests@example.com']);
    git(repo, ['config', 'user.name', 'PaF Tests']);

    write(repo, '.gitignore', 'ignored.txt\n');
    write(repo, 'tracked.txt', 'base tracked content\n');
    write(repo, 'delete-me.txt', 'tracked deletion content\n');
    write(repo, 'rename-me.txt', 'tracked rename content\n');
    git(repo, ['add', '.gitignore', 'tracked.txt', 'delete-me.txt', 'rename-me.txt']);
    git(repo, ['commit', '-m', 'base']);

    git(repo, ['switch', '-c', 'feature/review-scope']);
    write(repo, 'branch.txt', 'committed branch content\n');
    git(repo, ['add', 'branch.txt']);
    git(repo, ['commit', '-m', 'branch work']);

    run = vi.fn(async () => 'review complete');
    const backend: Backend = {
      name: 'scope-fixture',
      localFileAccess: false,
      allowedSandboxes: new Set(['read-only']),
      capabilities: {
        resumeStrategy: 'unsupported',
        requiresClientSessionId: false,
      },
      run,
    };

    _resetRegistry();
    registerBackend(backend);
    process.env.PHONE_A_FRIEND_DEPTH = '0';
  });

  afterEach(() => {
    _resetRegistry();
    if (originalDepth === undefined) {
      delete process.env.PHONE_A_FRIEND_DEPTH;
    } else {
      process.env.PHONE_A_FRIEND_DEPTH = originalDepth;
    }
    rmSync(repo, { recursive: true, force: true });
  });

  it('working-tree reviews staged, unstaged, and untracked files but not branch commits or ignored files', async () => {
    write(repo, 'staged.txt', 'staged working tree content\n');
    git(repo, ['add', 'staged.txt']);
    write(repo, 'tracked.txt', 'unstaged working tree content\n');
    write(repo, 'untracked.txt', 'untracked working tree content\n');
    write(repo, 'ignored.txt', 'ignored secret content\n');
    rmSync(join(repo, 'delete-me.txt'));
    git(repo, ['mv', 'rename-me.txt', 'renamed.txt']);

    await reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      prompt: 'Review the selected scope.',
    });

    const prompt = run.mock.calls[0][0].prompt;
    expect(prompt).toContain('staged working tree content');
    expect(prompt).toContain('unstaged working tree content');
    expect(prompt).toContain('untracked working tree content');
    expect(prompt).toContain('delete-me.txt');
    expect(prompt).toContain('renamed.txt');
    expect(prompt).not.toContain('committed branch content');
    expect(prompt).not.toContain('ignored secret content');
  });

  it('all reviews branch commits together with staged, unstaged, and untracked files', async () => {
    write(repo, 'staged.txt', 'staged all-scope content\n');
    git(repo, ['add', 'staged.txt']);
    write(repo, 'tracked.txt', 'unstaged all-scope content\n');
    write(repo, 'untracked.txt', 'untracked all-scope content\n');
    write(repo, 'ignored.txt', 'ignored all-scope secret\n');

    await reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'all',
      prompt: 'Review the selected scope.',
    });

    const prompt = run.mock.calls[0][0].prompt;
    expect(prompt).toContain('committed branch content');
    expect(prompt).toContain('staged all-scope content');
    expect(prompt).toContain('unstaged all-scope content');
    expect(prompt).toContain('untracked all-scope content');
    expect(prompt).not.toContain('ignored all-scope secret');
  });

  it('reviews the whole worktree when repoPath points at a subdirectory', async () => {
    const nested = join(repo, 'nested');
    mkdirSync(nested);
    write(repo, 'tracked.txt', 'root tracked from nested invocation\n');
    write(repo, 'root-untracked.txt', 'root untracked from nested invocation\n');
    write(repo, 'nested/nested-untracked.txt', 'nested untracked content\n');

    await reviewRelay({
      repoPath: nested,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      prompt: 'Review the selected scope.',
    });

    const call = run.mock.calls[0][0];
    expect(realpathSync(call.repoPath)).toBe(realpathSync(repo));
    expect(call.prompt).toContain('root tracked from nested invocation');
    expect(call.prompt).toContain('root untracked from nested invocation');
    expect(call.prompt).toContain('nested untracked content');
  });

  it('reviews staged and untracked files before the first commit', async () => {
    const unbornRepo = mkdtempSync(join(tmpdir(), 'paf-review-scope-unborn-'));
    try {
      git(unbornRepo, ['init', '--initial-branch=main']);
      write(unbornRepo, 'staged.txt', 'staged before first commit\n');
      git(unbornRepo, ['add', 'staged.txt']);
      write(unbornRepo, 'untracked.txt', 'untracked before first commit\n');

      await reviewRelay({
        repoPath: unbornRepo,
        backend: 'scope-fixture',
        base: 'main',
        scope: 'working-tree',
        prompt: 'Review the selected scope.',
      });

      const prompt = run.mock.calls[0][0].prompt;
      expect(prompt).toContain('staged before first commit');
      expect(prompt).toContain('untracked before first commit');
    } finally {
      rmSync(unbornRepo, { recursive: true, force: true });
    }
  });

  it('treats all scope as pending work before the first commit', async () => {
    const unbornRepo = mkdtempSync(join(tmpdir(), 'paf-review-scope-unborn-all-'));
    try {
      git(unbornRepo, ['init', '--initial-branch=main']);
      write(unbornRepo, 'staged.txt', 'all-scope staged before first commit\n');
      git(unbornRepo, ['add', 'staged.txt']);
      write(unbornRepo, 'untracked.txt', 'all-scope untracked before first commit\n');

      await reviewRelay({
        repoPath: unbornRepo,
        backend: 'scope-fixture',
        base: 'main',
        scope: 'all',
        prompt: 'Review the selected scope.',
      });

      const prompt = run.mock.calls[0][0].prompt;
      expect(prompt).toContain('all-scope staged before first commit');
      expect(prompt).toContain('all-scope untracked before first commit');
    } finally {
      rmSync(unbornRepo, { recursive: true, force: true });
    }
  });

  it('does not call a backend when the selected working-tree scope is clean', async () => {
    const result = await reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      prompt: 'Review the selected scope.',
    });

    expect(result).toBe('No changes found for review scope "working-tree".');
    expect(run).not.toHaveBeenCalled();
  });

  it('returns an abstain envelope for a clean verdict review', async () => {
    const result = await reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      verdictJson: true,
    });

    expect(JSON.parse(result)).toEqual({
      schema_version: 1,
      verdict: 'abstain',
      summary: 'No changes found for review scope "working-tree".',
      findings: [],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('does not invoke a native reviewer when the selected scope is clean', async () => {
    const nativeReview = vi.fn(async () => 'native review complete');
    registerBackend({
      name: 'native-scope-fixture',
      localFileAccess: true,
      allowedSandboxes: new Set(['read-only']),
      capabilities: {
        resumeStrategy: 'unsupported',
        requiresClientSessionId: false,
      },
      nativeReviewScopes: new Set(['working-tree']),
      run,
      review: nativeReview,
    });

    const result = await reviewRelay({
      repoPath: repo,
      backend: 'native-scope-fixture',
      base: 'main',
      scope: 'working-tree',
    });

    expect(result).toBe('No changes found for review scope "working-tree".');
    expect(nativeReview).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('does not invoke a native reviewer for an empty branch scope', async () => {
    const nativeReview = vi.fn(async () => 'native review complete');
    registerBackend({
      name: 'native-branch-fixture',
      localFileAccess: true,
      allowedSandboxes: new Set(['read-only']),
      capabilities: {
        resumeStrategy: 'unsupported',
        requiresClientSessionId: false,
      },
      nativeReviewScopes: new Set(['branch']),
      run,
      review: nativeReview,
    });

    const result = await reviewRelay({
      repoPath: repo,
      backend: 'native-branch-fixture',
      base: 'HEAD',
      scope: 'branch',
    });

    expect(result).toBe('No changes found for review scope "branch".');
    expect(nativeReview).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('uses a scope-specific default request for an ordinary review', async () => {
    write(repo, 'untracked.txt', 'prompt scope content\n');

    await reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
    });

    expect(run.mock.calls[0][0].prompt).toContain(
      'Review the staged, unstaged, and untracked working-tree changes.',
    );
  });

  it('represents an untracked binary file without embedding its bytes', async () => {
    writeFileSync(join(repo, 'asset.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));

    await reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      prompt: 'Review the selected scope.',
    });

    const prompt = run.mock.calls[0][0].prompt;
    expect(prompt).toContain('asset.bin');
    expect(prompt).toContain('Binary files');
    expect(prompt).not.toContain('\u0000');
  });

  it('includes an empty untracked file in the review scope', async () => {
    write(repo, 'empty.txt', '');

    await reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      prompt: 'Review the selected scope.',
    });

    expect(run.mock.calls[0][0].prompt).toContain('empty.txt');
  });

  it('fails closed when untracked working-tree content exceeds the diff limit', async () => {
    write(repo, 'oversized.txt', 'x'.repeat(MAX_DIFF_BYTES + 1));

    await expect(reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      prompt: 'Review the selected scope.',
    })).rejects.toThrow(/Git diff is too large/);

    expect(run.mock.calls.length).toBe(0);
  });

  it('reports the configured diff limit when Git output exceeds its process buffer', async () => {
    write(repo, 'very-oversized.txt', 'x'.repeat(1_200_000));

    await expect(reviewRelay({
      repoPath: repo,
      backend: 'scope-fixture',
      base: 'main',
      scope: 'working-tree',
      prompt: 'Review the selected scope.',
    })).rejects.toThrow(/Git diff is too large.*max 300000 bytes/);

    expect(run.mock.calls.length).toBe(0);
  });
});

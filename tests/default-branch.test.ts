/**
 * detectDefaultBranch() on real repositories: which ref a review is compared
 * against when --base is not given. No git mocking, so the refs, the remote
 * and the commit counts are the ones git itself reports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectDefaultBranch, gitDiffBase } from '../src/relay.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', env: GIT_ENV, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function commit(repo: string, file: string, content = `${file}\n`): void {
  writeFileSync(join(repo, file), content);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', `add ${file}`);
}

describe('detectDefaultBranch() on real repositories', () => {
  let root: string;
  let origin: string;
  let repo: string;

  /** A bare remote with one commit on `branch`, cloned into `repo` (so `origin/HEAD` is set). */
  function cloneWithDefault(branch: string): void {
    const seed = join(root, 'seed');
    execFileSync('git', ['init', '-q', '-b', branch, seed], { env: GIT_ENV });
    commit(seed, 'base.txt');
    execFileSync('git', ['clone', '-q', '--bare', seed, origin], { env: GIT_ENV });
    execFileSync('git', ['clone', '-q', origin, repo], { env: GIT_ENV });
  }

  /** Someone else merges `count` commits into the remote's `branch`; `repo` fetches but does not pull. */
  function upstreamMovesAhead(branch: string, count: number): void {
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', '-b', branch, origin, other], { env: GIT_ENV });
    for (let i = 0; i < count; i += 1) commit(other, `upstream-${i}.txt`);
    git(other, 'push', '-q', 'origin', branch);
    git(repo, 'fetch', '-q', 'origin');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-default-branch-'));
    origin = join(root, 'origin.git');
    repo = join(root, 'repo');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses the local main for a branch cut from it', () => {
    cloneWithDefault('main');
    git(repo, 'switch', '-q', '-c', 'feat');
    commit(repo, 'feature.txt');

    expect(detectDefaultBranch(repo)).toBe('main');
  });

  it('uses origin/main when the local main was never pulled', () => {
    cloneWithDefault('main');
    upstreamMovesAhead('main', 3);
    // The feature branch starts from the fetched remote branch; local main is 3 commits behind.
    git(repo, 'switch', '-q', '-c', 'feat', 'origin/main');
    commit(repo, 'feature.txt');

    expect(git(repo, 'rev-list', '--count', 'main..HEAD')).toBe('4');
    expect(detectDefaultBranch(repo)).toBe('origin/main');

    const diff = gitDiffBase(repo, detectDefaultBranch(repo));
    expect(diff).toContain('feature.txt');
    expect(diff).not.toContain('upstream-0.txt');
    // What the old choice reviewed: the feature plus the three commits merged upstream.
    expect(gitDiffBase(repo, 'main')).toContain('upstream-0.txt');
  });

  it('keeps the local main when it is ahead of the remote', () => {
    cloneWithDefault('main');
    commit(repo, 'local-only.txt');
    git(repo, 'switch', '-q', '-c', 'feat');
    commit(repo, 'feature.txt');

    expect(detectDefaultBranch(repo)).toBe('main');
    expect(gitDiffBase(repo, 'main')).not.toContain('local-only.txt');
  });

  it('keeps the local main when both are equally near', () => {
    cloneWithDefault('main');
    upstreamMovesAhead('main', 2);
    // Cut from the stale local main: both refs share the same merge base with HEAD.
    git(repo, 'switch', '-q', '-c', 'feat', 'main');
    commit(repo, 'feature.txt');

    expect(detectDefaultBranch(repo)).toBe('main');
  });

  it('stays on main, with nothing to review, when the review runs on main itself', () => {
    cloneWithDefault('main');
    commit(repo, 'unpushed.txt');

    expect(detectDefaultBranch(repo)).toBe('main');
    expect(gitDiffBase(repo, 'main')).toBe('');
  });

  it("uses the remote's default branch when it is not main or master", () => {
    cloneWithDefault('develop');
    git(repo, 'switch', '-q', '-c', 'feat');
    commit(repo, 'feature.txt');

    expect(detectDefaultBranch(repo)).toBe('develop');
  });

  it("prefers the remote's default branch over a main that lags behind it", () => {
    cloneWithDefault('develop');
    // A release branch named main, left at the first commit while develop moves on.
    git(repo, 'branch', 'main');
    commit(repo, 'develop-work.txt');
    git(repo, 'switch', '-q', '-c', 'feat');
    commit(repo, 'feature.txt');

    expect(detectDefaultBranch(repo)).toBe('develop');
    expect(gitDiffBase(repo, 'develop')).not.toContain('develop-work.txt');
  });

  it("uses upstream/main in a fork whose own main lags behind the parent's", () => {
    cloneWithDefault('main');
    // The parent repository, three commits ahead of the fork (origin) and of the local main.
    const parent = join(root, 'parent.git');
    execFileSync('git', ['clone', '-q', '--bare', origin, parent], { env: GIT_ENV });
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', parent, other], { env: GIT_ENV });
    for (let i = 0; i < 3; i += 1) commit(other, `upstream-${i}.txt`);
    git(other, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'add', 'upstream', parent);
    git(repo, 'fetch', '-q', 'upstream');
    git(repo, 'switch', '-q', '-c', 'feat', 'upstream/main');
    commit(repo, 'feature.txt');

    expect(git(repo, 'rev-list', '--count', 'origin/main..HEAD')).toBe('4');
    expect(detectDefaultBranch(repo)).toBe('upstream/main');
    expect(gitDiffBase(repo, 'upstream/main')).not.toContain('upstream-0.txt');
  });

  it('ignores a remote that is neither origin nor upstream', () => {
    cloneWithDefault('main');
    git(repo, 'switch', '-q', '-c', 'feat');
    commit(repo, 'feature.txt');
    // A deploy remote that already holds the feature: zero commits away, but not a review base.
    const deploy = join(root, 'deploy.git');
    execFileSync('git', ['init', '-q', '--bare', deploy], { env: GIT_ENV });
    git(repo, 'remote', 'add', 'staging', deploy);
    git(repo, 'push', '-q', 'staging', 'feat:main');
    git(repo, 'fetch', '-q', 'staging');

    expect(git(repo, 'rev-list', '--count', 'staging/main..HEAD')).toBe('0');
    expect(detectDefaultBranch(repo)).toBe('main');
    expect(gitDiffBase(repo, 'main')).toContain('feature.txt');
  });

  it('works on a detached HEAD', () => {
    cloneWithDefault('main');
    git(repo, 'switch', '-q', '-c', 'feat');
    commit(repo, 'feature.txt');
    git(repo, 'switch', '-q', '--detach');

    expect(detectDefaultBranch(repo)).toBe('main');
    expect(gitDiffBase(repo, 'main')).toContain('feature.txt');
  });

  it('works in a shallow clone', () => {
    cloneWithDefault('main');
    upstreamMovesAhead('main', 3);
    const shallow = join(root, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, shallow], { env: GIT_ENV });
    git(shallow, 'switch', '-q', '-c', 'feat');
    commit(shallow, 'feature.txt');

    expect(detectDefaultBranch(shallow)).toBe('main');
    const diff = gitDiffBase(shallow, 'main');
    expect(diff).toContain('feature.txt');
    expect(diff).not.toContain('upstream-0.txt');
  });

  it('uses master in a repository without a remote', () => {
    execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: GIT_ENV });
    commit(repo, 'base.txt');
    git(repo, 'switch', '-q', '-c', 'feat');
    commit(repo, 'feature.txt');

    expect(detectDefaultBranch(repo)).toBe('master');
  });

  it('falls back to HEAD~1 when no candidate exists', () => {
    execFileSync('git', ['init', '-q', '-b', 'trunk', repo], { env: GIT_ENV });
    commit(repo, 'base.txt');
    commit(repo, 'second.txt');

    expect(detectDefaultBranch(repo)).toBe('HEAD~1');
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe('built CLI review scope', () => {
  let root: string;
  let repo: string;
  let worktree: string;
  let fakeBin: string;
  let capturedArgs: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-review-scope-e2e-'));
    repo = join(root, 'repo');
    worktree = join(root, 'linked-worktree');
    fakeBin = join(root, 'bin');
    capturedArgs = join(root, 'codex-args.txt');
    mkdirSync(repo);
    mkdirSync(fakeBin);

    git(repo, ['init', '--initial-branch=main']);
    git(repo, ['config', 'user.email', 'paf-tests@example.com']);
    git(repo, ['config', 'user.name', 'PaF Tests']);
    writeFileSync(join(repo, 'tracked.txt'), 'base tracked content\n');
    git(repo, ['add', 'tracked.txt']);
    git(repo, ['commit', '-m', 'base']);
    git(repo, ['worktree', 'add', '-b', 'feature/review-scope-e2e', worktree, 'main']);

    writeFileSync(join(worktree, 'branch.txt'), 'linked worktree branch content\n');
    git(worktree, ['add', 'branch.txt']);
    git(worktree, ['commit', '-m', 'branch work']);
    writeFileSync(join(worktree, 'staged.txt'), 'linked worktree staged content\n');
    git(worktree, ['add', 'staged.txt']);
    writeFileSync(join(worktree, 'tracked.txt'), 'linked worktree unstaged content\n');
    writeFileSync(join(worktree, 'untracked.txt'), 'linked worktree untracked content\n');

    const fakeCodex = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.PAF_E2E_CAPTURE, args.join('\\0'));
const outputFlag = args.indexOf('--output-last-message');
if (outputFlag < 0 || !args[outputFlag + 1]) process.exit(3);
fs.writeFileSync(args[outputFlag + 1], JSON.stringify({
  schema_version: 1,
  verdict: 'ship',
  summary: 'fixture review complete',
  findings: [],
}));
`;
    const fakeCodexPath = join(fakeBin, 'codex');
    writeFileSync(fakeCodexPath, fakeCodex);
    chmodSync(fakeCodexPath, 0o755);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reviews committed and pending changes from a linked worktree with all scope', () => {
    const entrypoint = join(process.cwd(), 'dist', 'index.js');
    const result = spawnSync(process.execPath, [
      entrypoint,
      'relay',
      '--to', 'codex',
      '--repo', worktree,
      '--review',
      '--review-scope', 'all',
      '--verdict-json',
      '--base', 'main',
      '--no-stream',
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        PAF_E2E_CAPTURE: capturedArgs,
        PHONE_A_FRIEND_DEPTH: '0',
        PHONE_A_FRIEND_HOST: '',
        XDG_CONFIG_HOME: join(root, 'config'),
        CI: 'true',
        TERM: 'dumb',
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 1,
      verdict: 'ship',
      findings: [],
    });

    const args = readFileSync(capturedArgs, 'utf-8');
    expect(args).toContain('Review the committed branch changes plus staged, unstaged, and untracked working-tree changes.');
    expect(args).toContain('linked worktree branch content');
    expect(args).toContain('linked worktree staged content');
    expect(args).toContain('linked worktree unstaged content');
    expect(args).toContain('linked worktree untracked content');
  });

  it('returns abstain without invoking the backend for a clean working-tree scope', () => {
    git(worktree, ['reset', '--hard', 'HEAD']);
    rmSync(join(worktree, 'untracked.txt'));

    const entrypoint = join(process.cwd(), 'dist', 'index.js');
    const result = spawnSync(process.execPath, [
      entrypoint,
      'relay',
      '--to', 'codex',
      '--repo', worktree,
      '--review-scope', 'working-tree',
      '--verdict-json',
      '--no-stream',
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        PAF_E2E_CAPTURE: capturedArgs,
        PHONE_A_FRIEND_DEPTH: '0',
        PHONE_A_FRIEND_HOST: '',
        XDG_CONFIG_HOME: join(root, 'config'),
        CI: 'true',
        TERM: 'dumb',
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schema_version: 1,
      verdict: 'abstain',
      summary: 'No changes found for review scope "working-tree".',
      findings: [],
    });
    expect(existsSync(capturedArgs)).toBe(false);
  });
});

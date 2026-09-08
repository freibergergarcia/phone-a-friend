import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore, hashText } from '../src/tasks.js';
import { beginTrackedRun, describeRepo, promptPreview } from '../src/task-tracking.js';

describe('beginTrackedRun', () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paf-tracking-'));
    store = new TaskStore(join(dir, 'tasks.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const base = {
    kind: 'review' as const,
    backend: 'codex',
    repoPath: '/tmp/not-a-repo',
    prompt: 'Review the authentication changes. Focus on session expiry.',
    model: 'gpt-6',
    sandbox: 'read-only',
    reviewScope: 'working-tree',
    reviewBase: 'main',
    host: 'claude',
    pid: 4321,
  };

  it('records nothing and opens no store when history is off', () => {
    const openStore = vi.fn(() => store);
    const run = beginTrackedRun({ ...base, mode: 'off', openStore });
    expect(run.id).toBeNull();
    expect(run.observer).toBeUndefined();
    run.complete('ignored');
    run.fail(new Error('ignored'));
    run.close();
    expect(openStore).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });

  it('creates a running task with prompt preview and hash in results mode', () => {
    const run = beginTrackedRun({ ...base, mode: 'results', openStore: () => store });
    expect(run.id).toMatch(/^[0-9a-f]{8}$/);
    const task = store.get(run.id!)!;
    expect(task).toMatchObject({
      status: 'running',
      kind: 'review',
      backend: 'codex',
      model: 'gpt-6',
      sandbox: 'read-only',
      reviewScope: 'working-tree',
      reviewBase: 'main',
      host: 'claude',
      pid: 4321,
      promptPreview: 'Review the authentication changes. Focus on session expiry.',
      promptHash: hashText(base.prompt),
    });
    expect(store.events(run.id!).map((e) => e.type)).toEqual(['started']);
  });

  it('stores the result on complete and the error on fail', () => {
    const ok = beginTrackedRun({ ...base, mode: 'results', openStore: () => store });
    ok.complete('Looks good.');
    expect(store.get(ok.id!)).toMatchObject({ status: 'completed', result: 'Looks good.' });
    expect(store.events(ok.id!).map((e) => e.type)).toEqual(['started', 'completed']);

    const bad = beginTrackedRun({ ...base, mode: 'results', openStore: () => store });
    bad.fail(new Error('codex exec timed out after 600s'));
    expect(store.get(bad.id!)).toMatchObject({ status: 'failed', error: 'codex exec timed out after 600s' });
    expect(store.events(bad.id!).map((e) => e.type)).toEqual(['started', 'failed']);
  });

  it('keeps hashes and events but drops prompt and result text in metadata mode', () => {
    const run = beginTrackedRun({ ...base, mode: 'metadata', openStore: () => store });
    run.complete('secret result');
    const task = store.get(run.id!)!;
    expect(task.promptPreview).toBeNull();
    expect(task.promptHash).toBe(hashText(base.prompt));
    expect(task.result).toBeNull();
    expect(task.status).toBe('completed');
    expect(store.events(run.id!).map((e) => e.type)).toEqual(['started', 'completed']);
  });

  it('records scope, session link, progress events, and drift through the observer', () => {
    const run = beginTrackedRun({ ...base, mode: 'results', openStore: () => store });
    const observer = run.observer!;
    observer.onScope!({ scope: 'working-tree', base: 'main', diffHash: 'h1', diffBytes: 321, diffFiles: 4 });
    observer.onSessionLinked!('thr-1');
    observer.onEvent!({ type: 'activity', message: 'Running: git status', data: { itemId: 'i1' } });
    observer.onDrift!({ drifted: true, diffHash: 'h2' });
    run.complete('done');

    const task = store.get(run.id!)!;
    expect(task).toMatchObject({ diffHash: 'h1', diffBytes: 321, diffFiles: 4, backendSessionId: 'thr-1', driftDetected: true });
    expect(run.drift).toEqual({ drifted: true, diffHash: 'h2' });
    const events = store.events(run.id!);
    expect(events.map((e) => e.type)).toEqual(['started', 'scope_captured', 'session_linked', 'activity', 'drift_detected', 'completed']);
    expect(events[3].data).toEqual({ itemId: 'i1' });
  });

  it('distinguishes verified and unknown drift', () => {
    const verified = beginTrackedRun({ ...base, mode: 'results', openStore: () => store });
    verified.observer!.onDrift!({ drifted: false, diffHash: 'h1' });
    expect(store.get(verified.id!)!.driftDetected).toBe(false);
    expect(store.events(verified.id!).map((e) => e.type)).toContain('scope_verified');

    const unknown = beginTrackedRun({ ...base, mode: 'results', openStore: () => store });
    unknown.observer!.onDrift!({ drifted: null, diffHash: null });
    expect(store.get(unknown.id!)!.driftDetected).toBeNull();
    expect(store.events(unknown.id!).map((e) => e.type)).toContain('drift_unknown');
  });

  it('degrades to untracked with a warning when the store cannot be opened', () => {
    const warn = vi.fn();
    const run = beginTrackedRun({
      ...base,
      mode: 'results',
      openStore: () => { throw new Error('SQLITE_CANTOPEN'); },
      warn,
    });
    expect(run.id).toBeNull();
    expect(run.observer).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/task tracking disabled/i);
    expect(() => { run.complete('x'); run.fail('y'); run.close(); }).not.toThrow();
  });

  it('infers the host from environment markers when not given', () => {
    const original = { host: process.env.PHONE_A_FRIEND_HOST, claude: process.env.CLAUDECODE };
    try {
      process.env.PHONE_A_FRIEND_HOST = 'opencode';
      process.env.CLAUDECODE = '1';
      const shim = beginTrackedRun({ ...base, host: undefined, mode: 'results', openStore: () => store });
      expect(store.get(shim.id!)!.host).toBe('opencode');
      delete process.env.PHONE_A_FRIEND_HOST;
      const claude = beginTrackedRun({ ...base, host: undefined, mode: 'results', openStore: () => store });
      expect(store.get(claude.id!)!.host).toBe('claude');
      delete process.env.CLAUDECODE;
      const none = beginTrackedRun({ ...base, host: undefined, mode: 'results', openStore: () => store });
      expect(store.get(none.id!)!.host).toBeNull();
    } finally {
      if (original.host === undefined) delete process.env.PHONE_A_FRIEND_HOST; else process.env.PHONE_A_FRIEND_HOST = original.host;
      if (original.claude === undefined) delete process.env.CLAUDECODE; else process.env.CLAUDECODE = original.claude;
    }
  });
});

describe('describeRepo', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paf-describe-repo-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the worktree root, branch, and head sha for a git repository', () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    git('init', '-q', '-b', 'feat/x');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'init');
    const sha = git('rev-parse', 'HEAD');
    const nested = join(dir, 'sub');
    execFileSync('mkdir', ['-p', nested]);

    const info = describeRepo(nested);
    expect(info.root).toBe(git('rev-parse', '--show-toplevel'));
    expect(info.branch).toBe('feat/x');
    expect(info.headSha).toBe(sha);
  });

  it('falls back to the resolved path with unknown branch and sha outside git', () => {
    const info = describeRepo(dir);
    expect(info.root).toBe(dir);
    expect(info.branch).toBeNull();
    expect(info.headSha).toBeNull();
    expect(existsSync(join(dir, '.git'))).toBe(false);
  });
});

describe('promptPreview', () => {
  it('collapses whitespace and truncates long prompts', () => {
    expect(promptPreview('  hello\n\n  world  ')).toBe('hello world');
    const long = 'a'.repeat(500);
    expect(promptPreview(long)).toHaveLength(201);
    expect(promptPreview(long).endsWith('…')).toBe(true);
    expect(promptPreview(null)).toBeNull();
  });
});

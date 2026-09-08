import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TaskStore,
  defaultTaskDbPath,
  hashText,
  isProcessAlive,
} from '../src/tasks.js';

function makeStore(dir: string): TaskStore {
  return new TaskStore(join(dir, 'tasks.db'));
}

const baseTask = {
  kind: 'review' as const,
  backend: 'codex',
  repoPath: '/tmp/repo',
  model: 'gpt-6',
  sandbox: 'read-only',
  branch: 'feat/x',
  headSha: 'abc123',
  reviewScope: 'working-tree',
  reviewBase: 'main',
  promptPreview: 'Review the auth changes',
  promptHash: 'deadbeef',
  sessionLabel: null,
  host: 'claude',
};

describe('TaskStore', () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paf-tasks-'));
    store = makeStore(dir);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a queued task with a short id, timestamps, and the given metadata', () => {
    const task = store.create(baseTask);
    expect(task.id).toMatch(/^[0-9a-f]{8}$/);
    expect(task.status).toBe('queued');
    expect(task.kind).toBe('review');
    expect(task.backend).toBe('codex');
    expect(task.repoPath).toBe('/tmp/repo');
    expect(task.reviewScope).toBe('working-tree');
    expect(task.promptPreview).toBe('Review the auth changes');
    expect(task.host).toBe('claude');
    expect(task.createdAt).toBe(task.updatedAt);
    expect(task.startedAt).toBeNull();
    expect(task.finishedAt).toBeNull();
    expect(task.result).toBeNull();
    expect(task.driftDetected).toBeNull();
    expect(store.get(task.id)).toEqual(task);
  });

  it('start() marks the task running with pid and startedAt', () => {
    const { id } = store.create(baseTask);
    store.start(id, 4242);
    const task = store.get(id)!;
    expect(task.status).toBe('running');
    expect(task.pid).toBe(4242);
    expect(task.startedAt).not.toBeNull();
  });

  it('complete() stores the result and fail() stores the error, both with finishedAt', () => {
    const a = store.create(baseTask);
    const b = store.create(baseTask);
    store.start(a.id, 1);
    store.start(b.id, 1);
    store.complete(a.id, 'looks good');
    store.fail(b.id, 'codex exec timed out');
    expect(store.get(a.id)).toMatchObject({ status: 'completed', result: 'looks good' });
    expect(store.get(a.id)!.finishedAt).not.toBeNull();
    expect(store.get(b.id)).toMatchObject({ status: 'failed', error: 'codex exec timed out', result: null });
    expect(store.get(b.id)!.finishedAt).not.toBeNull();
  });

  it('complete() with a null result records completion without content (metadata mode)', () => {
    const { id } = store.create(baseTask);
    store.complete(id, null);
    expect(store.get(id)).toMatchObject({ status: 'completed', result: null });
  });

  it('update() patches scope, session, and drift fields and bumps updatedAt', () => {
    const created = store.create(baseTask);
    store.update(created.id, {
      diffHash: 'hash1',
      diffBytes: 1234,
      diffFiles: 4,
      backendSessionId: 'thread-1',
      driftDetected: true,
    });
    const task = store.get(created.id)!;
    expect(task).toMatchObject({
      diffHash: 'hash1',
      diffBytes: 1234,
      diffFiles: 4,
      backendSessionId: 'thread-1',
      driftDetected: true,
    });
    expect(task.updatedAt >= created.updatedAt).toBe(true);
    expect(store.update('nope', { diffHash: 'x' })).toBeNull();
  });

  it('addEvent() appends ordered events with optional data', () => {
    const { id } = store.create(baseTask);
    store.addEvent(id, 'scope_captured', 'Captured 4 changed files', { files: 4 });
    store.addEvent(id, 'activity', 'Running: git status');
    const events = store.events(id);
    expect(events.map((e) => e.type)).toEqual(['scope_captured', 'activity']);
    expect(events[0].data).toEqual({ files: 4 });
    expect(events[1].data).toBeNull();
    expect(events[0].id).toBeLessThan(events[1].id);
    expect(events.every((e) => e.taskId === id && typeof e.ts === 'string')).toBe(true);
  });

  it('get() resolves an exact id or a unique prefix of at least four characters', () => {
    const a = store.create(baseTask);
    expect(store.get(a.id.slice(0, 4))!.id).toBe(a.id);
    expect(store.get(a.id.slice(0, 3))).toBeNull();
    expect(store.get('zzzzzzzz')).toBeNull();
  });

  it('list() returns newest first and filters by repo, status, and limit', () => {
    const a = store.create({ ...baseTask, repoPath: '/tmp/repo-a' });
    const b = store.create({ ...baseTask, repoPath: '/tmp/repo-b' });
    const c = store.create({ ...baseTask, repoPath: '/tmp/repo-a' });
    store.start(c.id, 1);
    expect(store.list().map((t) => t.id)).toEqual([c.id, b.id, a.id]);
    expect(store.list({ repoPath: '/tmp/repo-a' }).map((t) => t.id)).toEqual([c.id, a.id]);
    expect(store.list({ status: 'running' }).map((t) => t.id)).toEqual([c.id]);
    expect(store.list({ limit: 2 }).map((t) => t.id)).toEqual([c.id, b.id]);
  });

  it('delete() removes the task and its events', () => {
    const { id } = store.create(baseTask);
    store.addEvent(id, 'activity', 'x');
    expect(store.delete(id)).toBe(true);
    expect(store.get(id)).toBeNull();
    expect(store.events(id)).toEqual([]);
    expect(store.delete(id)).toBe(false);
  });

  it('pruneOlderThan() drops tasks created before the cutoff and clear() drops everything', () => {
    const old = store.create(baseTask);
    store.update(old.id, { createdAt: '2020-01-01T00:00:00.000Z' });
    const fresh = store.create(baseTask);
    const removed = store.pruneOlderThan(new Date('2021-01-01T00:00:00.000Z'));
    expect(removed).toEqual([old.id]);
    expect(store.list().map((t) => t.id)).toEqual([fresh.id]);
    expect(store.clear()).toBe(1);
    expect(store.list()).toEqual([]);
  });

  it('reconcileInterrupted() marks running tasks whose owner is gone and logs why', () => {
    const dead = store.create(baseTask);
    const alive = store.create(baseTask);
    const queued = store.create(baseTask);
    store.start(dead.id, 111);
    store.start(alive.id, 222);
    const marked = store.reconcileInterrupted((pid) => pid === 222);
    expect(marked).toEqual([dead.id]);
    expect(store.get(dead.id)).toMatchObject({ status: 'interrupted' });
    expect(store.get(dead.id)!.error).toMatch(/owner process/i);
    expect(store.get(dead.id)!.finishedAt).not.toBeNull();
    expect(store.events(dead.id).map((e) => e.type)).toEqual(['owner_lost']);
    expect(store.get(alive.id)!.status).toBe('running');
    expect(store.get(queued.id)!.status).toBe('queued');
    expect(store.reconcileInterrupted((pid) => pid === 222)).toEqual([]);
  });

  it('shows writes from a second connection on the same file', () => {
    const other = makeStore(dir);
    const task = other.create(baseTask);
    other.close();
    expect(store.get(task.id)!.id).toBe(task.id);
  });

  it('keeps every record when another process writes at the same time', async () => {
    const dbPath = join(dir, 'tasks.db');
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(${JSON.stringify(dbPath)});
      db.pragma('busy_timeout = 5000');
      const insert = db.prepare("INSERT INTO tasks (id, kind, status, backend, repo_path, created_at, updated_at) VALUES (?, 'relay', 'queued', 'codex', '/r', ?, ?)");
      process.stdout.write('ready\\n');
      setTimeout(() => {
        for (let i = 0; i < 300; i++) { const t = new Date().toISOString(); insert.run('child-' + String(i).padStart(4, '0'), t, t); }
        db.close();
      }, 10);
    `;
    const child = spawn(process.execPath, ['-e', script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    for (let i = 0; i < 300; i++) store.create(baseTask);
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code, stderr).toBe(0);
    expect(store.list({ limit: 1000 })).toHaveLength(600);
  });
});

describe('task helpers', () => {
  it('hashText returns a stable sha256 hex digest', () => {
    expect(hashText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashText('abc')).toBe(hashText('abc'));
  });

  it('defaultTaskDbPath honors XDG_CONFIG_HOME', () => {
    const original = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test';
    try {
      expect(defaultTaskDbPath()).toBe(join('/tmp/xdg-test', 'phone-a-friend', 'tasks.db'));
    } finally {
      if (original === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = original;
    }
  });

  it('isProcessAlive reports the current process as alive and a bogus pid as dead', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2147483646)).toBe(false);
  });
});

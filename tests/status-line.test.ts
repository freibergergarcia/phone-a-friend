import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore, type TaskRecord } from '../src/tasks.js';
import {
  formatAgo,
  formatElapsed,
  parseStatusLineStdin,
  pickStatusTask,
  renderStatusLine,
  statusLineForCwd,
  taskMatchesCwd,
} from '../src/status-line.js';

const NOW = new Date('2026-09-08T18:45:00.000Z');
const iso = (secondsBefore: number) => new Date(NOW.getTime() - secondsBefore * 1000).toISOString();

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'aaaaaaaa', kind: 'review', status: 'running', backend: 'codex', model: null, sandbox: 'read-only',
    repoPath: '/repo', branch: 'main', headSha: 'abc', reviewScope: 'working-tree', reviewBase: 'main',
    diffHash: null, diffBytes: null, diffFiles: null, driftDetected: null, promptPreview: null, promptHash: null,
    sessionLabel: null, backendSessionId: null, pid: 1, host: null, result: null, error: null,
    createdAt: iso(60), startedAt: iso(45), finishedAt: null, updatedAt: iso(45),
    ...overrides,
  };
}

describe('parseStatusLineStdin', () => {
  it('extracts cwd from the Claude Code status line JSON', () => {
    expect(parseStatusLineStdin('{"cwd":"/work/repo","session_id":"s1","workspace":{"current_dir":"/work/repo/sub"}}'))
      .toEqual({ cwd: '/work/repo/sub' });
  });

  it('falls back to cwd when workspace is absent and to null on garbage or empty input', () => {
    expect(parseStatusLineStdin('{"cwd":"/work/repo"}')).toEqual({ cwd: '/work/repo' });
    expect(parseStatusLineStdin('')).toEqual({ cwd: null });
    expect(parseStatusLineStdin('not json')).toEqual({ cwd: null });
  });
});

describe('formatting', () => {
  it('formats elapsed time as mm:ss and hh:mm:ss', () => {
    expect(formatElapsed(45_000)).toBe('00:45');
    expect(formatElapsed(72_000)).toBe('01:12');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
  });

  it('formats relative age compactly', () => {
    expect(formatAgo(5_000)).toBe('5s ago');
    expect(formatAgo(90_000)).toBe('1m ago');
    expect(formatAgo(7_200_000)).toBe('2h ago');
  });
});

describe('taskMatchesCwd', () => {
  it('matches the repo root itself and any directory below it, but not siblings', () => {
    const t = task({ repoPath: '/work/repo' });
    expect(taskMatchesCwd(t, '/work/repo')).toBe(true);
    expect(taskMatchesCwd(t, '/work/repo/src/deep')).toBe(true);
    expect(taskMatchesCwd(t, '/work/repo-other')).toBe(false);
    expect(taskMatchesCwd(t, '/work')).toBe(false);
  });
});

describe('pickStatusTask', () => {
  it('prefers the most recently started running task', () => {
    const older = task({ id: 'older111', startedAt: iso(300) });
    const newer = task({ id: 'newer222', startedAt: iso(20) });
    const done = task({ id: 'done3333', status: 'completed', finishedAt: iso(5) });
    expect(pickStatusTask([older, done, newer], { now: NOW, recentMinutes: 30 })?.id).toBe('newer222');
  });

  it('falls back to the most recently finished task within the recent window', () => {
    const old = task({ id: 'old11111', status: 'completed', finishedAt: iso(31 * 60) });
    const recent = task({ id: 'recent22', status: 'failed', finishedAt: iso(120) });
    const fresher = task({ id: 'fresh333', status: 'completed', finishedAt: iso(30) });
    expect(pickStatusTask([old, recent, fresher], { now: NOW, recentMinutes: 30 })?.id).toBe('fresh333');
    expect(pickStatusTask([old], { now: NOW, recentMinutes: 30 })).toBeNull();
  });
});

describe('renderStatusLine', () => {
  it('shows elapsed time and the last reported activity for a running task', () => {
    const line = renderStatusLine(
      task({ id: '319f3d35' }),
      { id: 1, taskId: '319f3d35', ts: iso(3), type: 'activity', message: 'Running: git diff', data: null },
      NOW,
    );
    expect(line).toBe('◇ PaF codex review 319f3d35 · 00:45 · Running: git diff');
  });

  it('says so when a running task has reported nothing yet', () => {
    expect(renderStatusLine(task({ id: '319f3d35' }), null, NOW)).toBe('◇ PaF codex review 319f3d35 · 00:45 · no activity reported yet');
  });

  it('summarizes finished tasks with age and drift, and failed tasks with the error', () => {
    const ok = task({ id: 'aaaa1111', status: 'completed', finishedAt: iso(90), driftDetected: false });
    expect(renderStatusLine(ok, null, NOW)).toBe('◇ PaF codex review aaaa1111 · completed 1m ago · scope unchanged');
    const drifted = task({ id: 'bbbb2222', status: 'completed', finishedAt: iso(90), driftDetected: true });
    expect(renderStatusLine(drifted, null, NOW)).toBe('◇ PaF codex review bbbb2222 · completed 1m ago · tree changed during review');
    const failed = task({ id: 'cccc3333', status: 'failed', finishedAt: iso(10), error: 'codex exec timed out after 600s and nothing else matters here at all' });
    expect(renderStatusLine(failed, null, NOW)).toBe('◇ PaF codex review cccc3333 · failed 10s ago · codex exec timed out after 600s and nothing else…');
    const relay = task({ id: 'dddd4444', kind: 'relay', status: 'interrupted', finishedAt: iso(10), error: 'Owner process exited before reporting a result' });
    expect(renderStatusLine(relay, null, NOW)).toMatch(/^◇ PaF codex relay dddd4444 · interrupted 10s ago · Owner process exited/);
  });

  it('truncates long activity messages', () => {
    const line = renderStatusLine(task({}), { id: 1, taskId: 'aaaaaaaa', ts: iso(1), type: 'activity', message: 'x'.repeat(200), data: null }, NOW);
    expect(line.length).toBeLessThan(140);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('statusLineForCwd', () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'paf-statusline-')));
    store = new TaskStore(join(dir, 'tasks.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('renders the running task for the cwd repo, ignores other repos, and returns empty when idle', () => {
    const t = store.create({ kind: 'review', backend: 'codex', repoPath: dir, reviewScope: 'branch' });
    store.start(t.id, process.pid);
    store.addEvent(t.id, 'activity', 'Running: npm test');
    const other = store.create({ kind: 'relay', backend: 'claude', repoPath: '/elsewhere' });
    store.start(other.id, process.pid);

    const line = statusLineForCwd(store, join(dir, 'src'));
    expect(line).toContain(`codex review ${t.id}`);
    expect(line).toContain('Running: npm test');
    expect(statusLineForCwd(store, '/nowhere/else')).toBe('');
  });

  it('marks dead owners as interrupted before rendering', () => {
    const t = store.create({ kind: 'review', backend: 'codex', repoPath: dir });
    store.start(t.id, 2147483646);
    const line = statusLineForCwd(store, dir);
    expect(line).toContain('interrupted');
  });

  it('returns empty for a null cwd', () => {
    expect(statusLineForCwd(store, null)).toBe('');
  });
});

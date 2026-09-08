/**
 * Task store — durable records for delegated work (relays and reviews).
 *
 * One SQLite file at ~/.config/phone-a-friend/tasks.db (XDG_CONFIG_HOME honored).
 * WAL mode plus a busy timeout let separate PaF processes write concurrently
 * without losing each other's records, which the JSON job store cannot do.
 *
 * Retention is a product choice made by the caller (see task-tracking.ts):
 * this store persists whatever it is handed and nothing more.
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Lazy-load better-sqlite3 (native addon can't be bundled by tsup).
// Uses the `require` shim injected by tsup's banner (createRequire).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Database: any;
function getDatabase() {
  if (!_Database) {
    _Database = require('better-sqlite3');
  }
  return _Database;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskKind = 'relay' | 'review';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';

export const TASK_STATUSES: readonly TaskStatus[] = ['queued', 'running', 'completed', 'failed', 'interrupted'];

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  backend: string;
  model: string | null;
  sandbox: string | null;
  repoPath: string;
  branch: string | null;
  headSha: string | null;
  reviewScope: string | null;
  reviewBase: string | null;
  diffHash: string | null;
  diffBytes: number | null;
  diffFiles: number | null;
  driftDetected: boolean | null;
  promptPreview: string | null;
  promptHash: string | null;
  sessionLabel: string | null;
  backendSessionId: string | null;
  pid: number | null;
  host: string | null;
  result: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  ts: string;
  type: string;
  message: string;
  data: Record<string, unknown> | null;
}

export interface CreateTaskInput {
  kind: TaskKind;
  backend: string;
  repoPath: string;
  model?: string | null;
  sandbox?: string | null;
  branch?: string | null;
  headSha?: string | null;
  reviewScope?: string | null;
  reviewBase?: string | null;
  promptPreview?: string | null;
  promptHash?: string | null;
  sessionLabel?: string | null;
  host?: string | null;
}

export type TaskPatch = Partial<Pick<TaskRecord,
  | 'model'
  | 'branch'
  | 'headSha'
  | 'reviewBase'
  | 'diffHash'
  | 'diffBytes'
  | 'diffFiles'
  | 'driftDetected'
  | 'backendSessionId'
  | 'sessionLabel'
  | 'createdAt'
>>;

export interface ListTasksOptions {
  repoPath?: string;
  status?: TaskStatus;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    backend TEXT NOT NULL,
    model TEXT,
    sandbox TEXT,
    repo_path TEXT NOT NULL,
    branch TEXT,
    head_sha TEXT,
    review_scope TEXT,
    review_base TEXT,
    diff_hash TEXT,
    diff_bytes INTEGER,
    diff_files INTEGER,
    drift_detected INTEGER,
    prompt_preview TEXT,
    prompt_hash TEXT,
    session_label TEXT,
    backend_session_id TEXT,
    pid INTEGER,
    host TEXT,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_repo_created ON tasks(repo_path, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id);
`;

const COLUMN_BY_FIELD: Record<keyof TaskPatch, string> = {
  model: 'model',
  branch: 'branch',
  headSha: 'head_sha',
  reviewBase: 'review_base',
  diffHash: 'diff_hash',
  diffBytes: 'diff_bytes',
  diffFiles: 'diff_files',
  driftDetected: 'drift_detected',
  backendSessionId: 'backend_session_id',
  sessionLabel: 'session_label',
  createdAt: 'created_at',
};

const MIN_PREFIX_LENGTH = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function defaultTaskDbPath(): string {
  const configBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(configBase, 'phone-a-friend', 'tasks.db');
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function now(): string {
  return new Date().toISOString();
}

interface TaskRow {
  id: string;
  kind: string;
  status: string;
  backend: string;
  model: string | null;
  sandbox: string | null;
  repo_path: string;
  branch: string | null;
  head_sha: string | null;
  review_scope: string | null;
  review_base: string | null;
  diff_hash: string | null;
  diff_bytes: number | null;
  diff_files: number | null;
  drift_detected: number | null;
  prompt_preview: string | null;
  prompt_hash: string | null;
  session_label: string | null;
  backend_session_id: string | null;
  pid: number | null;
  host: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    kind: row.kind as TaskKind,
    status: row.status as TaskStatus,
    backend: row.backend,
    model: row.model,
    sandbox: row.sandbox,
    repoPath: row.repo_path,
    branch: row.branch,
    headSha: row.head_sha,
    reviewScope: row.review_scope,
    reviewBase: row.review_base,
    diffHash: row.diff_hash,
    diffBytes: row.diff_bytes,
    diffFiles: row.diff_files,
    driftDetected: row.drift_detected === null ? null : row.drift_detected === 1,
    promptPreview: row.prompt_preview,
    promptHash: row.prompt_hash,
    sessionLabel: row.session_label,
    backendSessionId: row.backend_session_id,
    pid: row.pid,
    host: row.host,
    result: row.result,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

interface EventRow {
  id: number;
  task_id: string;
  ts: string;
  type: string;
  message: string;
  data: string | null;
}

function rowToEvent(row: EventRow): TaskEvent {
  let data: Record<string, unknown> | null = null;
  if (row.data) {
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  return { id: row.id, taskId: row.task_id, ts: row.ts, type: row.type, message: row.message, data };
}

function toColumnValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class TaskStore {
  private db: import('better-sqlite3').Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? defaultTaskDbPath();
    mkdirSync(dirname(path), { recursive: true });
    const Database = getDatabase();
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  create(input: CreateTaskInput): TaskRecord {
    const ts = now();
    const id = randomUUID().replace(/-/g, '').slice(0, 8);
    this.db.prepare(`
      INSERT INTO tasks (
        id, kind, status, backend, model, sandbox, repo_path, branch, head_sha,
        review_scope, review_base, prompt_preview, prompt_hash, session_label, host,
        created_at, updated_at
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.kind,
      input.backend,
      input.model ?? null,
      input.sandbox ?? null,
      input.repoPath,
      input.branch ?? null,
      input.headSha ?? null,
      input.reviewScope ?? null,
      input.reviewBase ?? null,
      input.promptPreview ?? null,
      input.promptHash ?? null,
      input.sessionLabel ?? null,
      input.host ?? null,
      ts,
      ts,
    );
    return this.get(id) as TaskRecord;
  }

  start(id: string, pid: number): void {
    const ts = now();
    this.db.prepare(
      "UPDATE tasks SET status = 'running', pid = ?, started_at = ?, updated_at = ? WHERE id = ?",
    ).run(pid, ts, ts, id);
  }

  complete(id: string, result: string | null): void {
    const ts = now();
    this.db.prepare(
      "UPDATE tasks SET status = 'completed', result = ?, finished_at = ?, updated_at = ? WHERE id = ?",
    ).run(result, ts, ts, id);
  }

  fail(id: string, error: string): void {
    const ts = now();
    this.db.prepare(
      "UPDATE tasks SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?",
    ).run(error, ts, ts, id);
  }

  update(id: string, patch: TaskPatch): TaskRecord | null {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(patch)) {
      const column = COLUMN_BY_FIELD[field as keyof TaskPatch];
      if (!column || value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(toColumnValue(value));
    }
    assignments.push('updated_at = ?');
    values.push(now());
    values.push(id);
    const info = this.db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    if (info.changes === 0) return null;
    return this.get(id);
  }

  addEvent(taskId: string, type: string, message: string, data?: Record<string, unknown>): TaskEvent {
    const ts = now();
    const info = this.db.prepare(
      'INSERT INTO task_events (task_id, ts, type, message, data) VALUES (?, ?, ?, ?, ?)',
    ).run(taskId, ts, type, message, data ? JSON.stringify(data) : null);
    return { id: Number(info.lastInsertRowid), taskId, ts, type, message, data: data ?? null };
  }

  events(taskId: string): TaskEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC',
    ).all(taskId) as EventRow[];
    return rows.map(rowToEvent);
  }

  get(idOrPrefix: string): TaskRecord | null {
    const exact = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(idOrPrefix) as TaskRow | undefined;
    if (exact) return rowToTask(exact);
    if (idOrPrefix.length < MIN_PREFIX_LENGTH) return null;
    const matches = this.db.prepare('SELECT * FROM tasks WHERE id LIKE ? LIMIT 2')
      .all(`${idOrPrefix.replace(/[%_]/g, '')}%`) as TaskRow[];
    return matches.length === 1 ? rowToTask(matches[0]) : null;
  }

  list(opts: ListTasksOptions = {}): TaskRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (opts.repoPath) {
      clauses.push('repo_path = ?');
      values.push(opts.repoPath);
    }
    if (opts.status) {
      clauses.push('status = ?');
      values.push(opts.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.floor(opts.limit ?? 20));
    const rows = this.db.prepare(
      `SELECT * FROM tasks ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    ).all(...values, limit) as TaskRow[];
    return rows.map(rowToTask);
  }

  delete(id: string): boolean {
    const info = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return info.changes > 0;
  }

  pruneOlderThan(cutoff: Date): string[] {
    const iso = cutoff.toISOString();
    const rows = this.db.prepare('SELECT id FROM tasks WHERE created_at < ?').all(iso) as Array<{ id: string }>;
    if (rows.length === 0) return [];
    this.db.prepare('DELETE FROM tasks WHERE created_at < ?').run(iso);
    return rows.map((r) => r.id);
  }

  clear(): number {
    const info = this.db.prepare('DELETE FROM tasks').run();
    return info.changes;
  }

  /**
   * Mark running tasks whose owner process is gone as interrupted.
   * A dead owner cannot report a result, so the record would otherwise
   * claim "running" forever. Silence alone is never treated as death:
   * only a missing pid is.
   */
  reconcileInterrupted(isAlive: (pid: number) => boolean = isProcessAlive): string[] {
    const running = this.db.prepare(
      "SELECT id, pid FROM tasks WHERE status = 'running' AND pid IS NOT NULL",
    ).all() as Array<{ id: string; pid: number }>;
    const marked: string[] = [];
    const mark = this.db.transaction((id: string) => {
      const ts = now();
      this.db.prepare(
        "UPDATE tasks SET status = 'interrupted', error = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'",
      ).run('Owner process exited before reporting a result', ts, ts, id);
      this.db.prepare(
        'INSERT INTO task_events (task_id, ts, type, message, data) VALUES (?, ?, ?, ?, NULL)',
      ).run(id, ts, 'owner_lost', 'Owner process exited before reporting a result');
    });
    for (const row of running) {
      if (isAlive(row.pid)) continue;
      mark(row.id);
      marked.push(row.id);
    }
    return marked;
  }
}

// ---------------------------------------------------------------------------
// Retention modes (resolved by config, applied by task-tracking)
// ---------------------------------------------------------------------------

/**
 * results: store status, scope hashes, events, prompt preview, and result text.
 * metadata: same without the prompt preview or result text.
 * off: record nothing for this run.
 */
export type TaskHistoryMode = 'results' | 'metadata' | 'off';
export const TASK_HISTORY_MODES: readonly TaskHistoryMode[] = ['results', 'metadata', 'off'];

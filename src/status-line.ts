/**
 * Status line — one row for Claude Code's status bar (or any shell) describing
 * the PaF task that matters for the current repository: the running one, or
 * the most recently finished one within a short window.
 *
 * Reads only what the store recorded. Elapsed time and the last reported
 * event are shown; nothing is inferred about what the backend is doing.
 */

import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import type { TaskEvent, TaskRecord, TaskStore } from './tasks.js';

export const STATUS_LINE_PREFIX = '◇';
/** How long a finished task stays on the row. Long enough to notice, short enough not to become history. */
export const DEFAULT_RECENT_MINUTES = 2;
const MAX_DETAIL_CHARS = 48;
const DETAIL_EVENT_TYPES = new Set(['activity', 'message', 'turn_failed', 'error']);

export function parseStatusLineStdin(text: string): { cwd: string | null } {
  if (!text.trim()) return { cwd: null };
  try {
    const json = JSON.parse(text) as { cwd?: unknown; workspace?: { current_dir?: unknown } };
    const cwd = json?.workspace?.current_dir ?? json?.cwd;
    return { cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : null };
  } catch {
    return { cwd: null };
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function truncateDetail(text: string, max = MAX_DETAIL_CHARS): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/** True when cwd is the task's worktree root or a directory below it. */
export function taskMatchesCwd(task: TaskRecord, cwd: string): boolean {
  const candidates = new Set([cwd]);
  try {
    candidates.add(realpathSync(cwd));
  } catch {
    // Non-existent cwd: compare the literal path only.
  }
  const root = task.repoPath.endsWith(sep) ? task.repoPath : task.repoPath + sep;
  for (const candidate of candidates) {
    if (candidate === task.repoPath || candidate.startsWith(root)) return true;
  }
  return false;
}

/** The running task started most recently, else the task finished most recently within the window. */
export function pickStatusTask(
  tasks: TaskRecord[],
  opts: { now: Date; recentMinutes: number },
): TaskRecord | null {
  const startKey = (t: TaskRecord) => t.startedAt ?? t.createdAt;
  const running = tasks
    .filter((t) => t.status === 'running' || t.status === 'queued')
    .sort((a, b) => startKey(b).localeCompare(startKey(a)));
  if (running.length > 0) return running[0];

  const cutoff = opts.now.getTime() - opts.recentMinutes * 60_000;
  const finished = tasks
    .filter((t) => t.finishedAt !== null && new Date(t.finishedAt).getTime() >= cutoff)
    .sort((a, b) => (b.finishedAt as string).localeCompare(a.finishedAt as string));
  return finished[0] ?? null;
}

/**
 * Compact by design: the row competes with the host's own status rows, so it
 * carries the one fact that matters and nothing that `task list` already has
 * (no brand, no id).
 */
export function renderStatusLine(
  task: TaskRecord,
  lastEvent: TaskEvent | null,
  now: Date,
  opts: { runningCount?: number } = {},
): string {
  const count = opts.runningCount ?? 0;
  const prefix = count > 1 ? `${STATUS_LINE_PREFIX} ${count} running · ` : `${STATUS_LINE_PREFIX} `;
  const head = `${prefix}${task.backend} ${task.kind}`;

  if (task.status === 'running' || task.status === 'queued') {
    const since = new Date(task.startedAt ?? task.createdAt).getTime();
    const detail = lastEvent ? truncateDetail(lastEvent.message) : 'no activity reported yet';
    return `${head} ${formatElapsed(now.getTime() - since)} · ${detail}`;
  }

  const ago = formatAgo(now.getTime() - new Date(task.finishedAt ?? task.updatedAt).getTime());
  if (task.status === 'completed') {
    let detail: string;
    if (task.kind === 'review') {
      detail = task.driftDetected === true
        ? 'tree changed, re-review'
        : task.driftDetected === false ? 'tree unchanged' : 'drift unknown';
    } else {
      detail = task.result === null ? 'no result retained' : 'result stored';
    }
    return `${head} done ${ago} · ${detail}`;
  }

  return `${head} ${task.status} ${ago} · ${truncateDetail(task.error ?? 'no error recorded')}`;
}

/** Full pipeline for a cwd: reconcile dead owners, pick, render. Empty string when nothing is relevant. */
export function statusLineForCwd(
  store: TaskStore,
  cwd: string | null,
  now: Date = new Date(),
  recentMinutes: number = DEFAULT_RECENT_MINUTES,
): string {
  if (!cwd) return '';
  store.reconcileInterrupted();
  const tasks = store.list({ limit: 500 }).filter((t) => taskMatchesCwd(t, cwd));
  const task = pickStatusTask(tasks, { now, recentMinutes });
  if (!task) return '';
  const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
  const lastEvent = [...store.events(task.id)].reverse().find((e) => DETAIL_EVENT_TYPES.has(e.type)) ?? null;
  return renderStatusLine(task, lastEvent, now, { runningCount });
}

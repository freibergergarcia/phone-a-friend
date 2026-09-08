/**
 * Task tracking — turns one CLI relay into a durable task record.
 *
 * The CLI calls beginTrackedRun() before a relay, hands the returned observer
 * to the relay core, and calls complete()/fail() afterwards. Everything here
 * is best-effort: a broken store degrades to an untracked run with one
 * warning, never a failed relay.
 *
 * Retention (task_history):
 *   results  — status, scope hashes, events, prompt preview, result text
 *   metadata — as above without prompt preview or result text
 *   off      — no record at all
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { RelayDriftInfo, RelayObserver } from './relay.js';
import { TaskStore, hashText, type TaskHistoryMode, type TaskKind } from './tasks.js';

const PROMPT_PREVIEW_CHARS = 200;

export interface TrackedRunInput {
  mode: TaskHistoryMode;
  kind: TaskKind;
  backend: string;
  repoPath: string;
  prompt: string | null;
  model?: string | null;
  sandbox?: string | null;
  sessionLabel?: string | null;
  reviewScope?: string | null;
  reviewBase?: string | null;
  /** Host that issued the relay. Defaults to an environment-derived guess. */
  host?: string | null;
  /** Owner pid recorded for interrupted-owner detection. Defaults to this process. */
  pid?: number;
  /** Store factory, injectable for tests. Defaults to the user's tasks.db. */
  openStore?: () => TaskStore;
  /** Receives one line when tracking has to be disabled. */
  warn?: (message: string) => void;
}

export interface TrackedRun {
  /** Task id, or null when this run is not being recorded. */
  id: string | null;
  /** Observer to hand to relay()/reviewRelay(); undefined when not recording. */
  observer: RelayObserver | undefined;
  /** Last drift report, for the CLI to warn about after the result is printed. */
  drift: RelayDriftInfo | null;
  complete(result: string): void;
  fail(error: unknown): void;
  close(): void;
}

export interface RepoDescription {
  root: string;
  branch: string | null;
  headSha: string | null;
}

function git(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/** Worktree root, branch, and HEAD for a path; nulls outside a repository. */
export function describeRepo(repoPath: string): RepoDescription {
  const resolved = resolve(repoPath);
  const root = git(resolved, ['rev-parse', '--show-toplevel']);
  if (!root) return { root: resolved, branch: null, headSha: null };
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    root: resolve(root),
    branch: branch === 'HEAD' ? null : branch,
    headSha: git(root, ['rev-parse', 'HEAD']),
  };
}

export function promptPreview(prompt: string | null): string | null {
  if (prompt === null) return null;
  const single = prompt.replace(/\s+/g, ' ').trim();
  return single.length > PROMPT_PREVIEW_CHARS ? `${single.slice(0, PROMPT_PREVIEW_CHARS)}…` : single;
}

function inferHost(): string | null {
  const explicit = process.env.PHONE_A_FRIEND_HOST?.trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.CLAUDECODE === '1') return 'claude';
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const UNTRACKED: Omit<TrackedRun, 'drift'> & { drift: null } = {
  id: null,
  observer: undefined,
  drift: null,
  complete() {},
  fail() {},
  close() {},
};

export function beginTrackedRun(input: TrackedRunInput): TrackedRun {
  if (input.mode === 'off') return { ...UNTRACKED };

  const warn = input.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  // An injected store belongs to the caller; only a default-opened one is closed here.
  const ownsStore = !input.openStore;
  let store: TaskStore;
  try {
    store = (input.openStore ?? (() => new TaskStore()))();
  } catch (err) {
    warn(`[phone-a-friend] Task tracking disabled for this run: ${errorMessage(err)}`);
    return { ...UNTRACKED };
  }

  const keepContent = input.mode === 'results';
  const repo = describeRepo(input.repoPath);
  let task;
  try {
    task = store.create({
      kind: input.kind,
      backend: input.backend,
      repoPath: repo.root,
      model: input.model ?? null,
      sandbox: input.sandbox ?? null,
      branch: repo.branch,
      headSha: repo.headSha,
      reviewScope: input.reviewScope ?? null,
      reviewBase: input.reviewBase ?? null,
      promptPreview: keepContent ? promptPreview(input.prompt) : null,
      promptHash: input.prompt === null ? null : hashText(input.prompt),
      sessionLabel: input.sessionLabel ?? null,
      host: input.host === undefined ? inferHost() : input.host,
    });
    store.start(task.id, input.pid ?? process.pid);
    store.addEvent(task.id, 'started', `${input.kind} started via ${input.backend}`);
  } catch (err) {
    warn(`[phone-a-friend] Task tracking disabled for this run: ${errorMessage(err)}`);
    if (ownsStore) { try { store.close(); } catch { /* ignore */ } }
    return { ...UNTRACKED };
  }

  const id = task.id;
  let closed = false;
  let degraded = false;
  const attempt = (fn: () => void): void => {
    if (closed || degraded) return;
    try {
      fn();
    } catch (err) {
      degraded = true;
      warn(`[phone-a-friend] Task ${id}: tracking stopped: ${errorMessage(err)}`);
    }
  };

  const run: TrackedRun = {
    id,
    drift: null,
    observer: {
      onScope(info) {
        attempt(() => {
          store.update(id, { diffHash: info.diffHash, diffBytes: info.diffBytes, diffFiles: info.diffFiles, reviewBase: info.base });
          store.addEvent(id, 'scope_captured', `Captured ${info.diffFiles} changed file(s), ${info.diffBytes} bytes (${info.scope})`, {
            scope: info.scope,
            base: info.base,
            diffHash: info.diffHash,
            diffFiles: info.diffFiles,
            diffBytes: info.diffBytes,
          });
        });
      },
      onSessionLinked(backendSessionId) {
        attempt(() => {
          store.update(id, { backendSessionId });
          store.addEvent(id, 'session_linked', `Backend session ${backendSessionId}`, { backendSessionId });
        });
      },
      onEvent(event) {
        if (event.type === 'session_linked') return; // handled by onSessionLinked
        attempt(() => {
          store.addEvent(id, event.type, event.message, event.data);
        });
      },
      onDrift(info) {
        run.drift = info;
        attempt(() => {
          store.update(id, { driftDetected: info.drifted });
          if (info.drifted === true) {
            store.addEvent(id, 'drift_detected', 'Working tree changed during the review; result covers the original snapshot', { diffHash: info.diffHash });
          } else if (info.drifted === false) {
            store.addEvent(id, 'scope_verified', 'Working tree unchanged since the review started', { diffHash: info.diffHash });
          } else {
            store.addEvent(id, 'drift_unknown', 'Could not re-check the working tree after the review');
          }
        });
      },
    },
    complete(result) {
      attempt(() => {
        store.complete(id, keepContent ? result : null);
        store.addEvent(id, 'completed', keepContent ? `Result stored (${result.length} chars)` : 'Completed (result not retained)');
      });
      run.close();
    },
    fail(error) {
      attempt(() => {
        const message = errorMessage(error);
        store.fail(id, message);
        store.addEvent(id, 'failed', message);
      });
      run.close();
    },
    close() {
      if (closed) return;
      closed = true;
      if (ownsStore) { try { store.close(); } catch { /* ignore */ } }
    },
  };
  return run;
}

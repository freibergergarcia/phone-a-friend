/**
 * Relay session store with JSON file persistence.
 *
 * Stores up to 100 sessions at ~/.config/phone-a-friend/sessions.json.
 *
 * NOT parallel-write safe: two PaF processes writing concurrently can lose
 * updates (last-writer-wins). Single-process use only. SQLite migration is
 * the proper fix when concurrency materializes.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionHistoryEntry } from './backends/index.js';

export interface RelaySession {
  id: string;
  backend: string;
  backendSessionId?: string;
  repoPath: string;
  history: SessionHistoryEntry[];
  createdAt: string;
  lastUsedAt: string;
}

const MAX_SESSIONS = 100;

export class SessionStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
      'phone-a-friend',
      'sessions.json',
    );
  }

  private load(): RelaySession[] {
    if (!existsSync(this.filePath)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      console.error(`[phone-a-friend] Failed to read session store ${this.filePath}: ${(err as Error).message}`);
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('session store is not a JSON array');
      }
      return parsed as RelaySession[];
    } catch (err) {
      // Loud recovery: rotate the corrupt file aside, log, return empty.
      // Stops silent total data loss when a partial write or schema break occurs.
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const rotated = `${this.filePath}.corrupt-${ts}`;
      try {
        renameSync(this.filePath, rotated);
        console.error(
          `[phone-a-friend] Session store at ${this.filePath} could not be parsed (${(err as Error).message}). ` +
            `Rotated to ${rotated}. Starting with an empty store.`,
        );
      } catch (rotateErr) {
        console.error(
          `[phone-a-friend] Session store at ${this.filePath} could not be parsed (${(err as Error).message}) ` +
            `and could not be rotated (${(rotateErr as Error).message}). Starting with an empty store; the file will be overwritten on next write.`,
        );
      }
      return [];
    }
  }

  private save(sessions: RelaySession[]): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    // Atomic write: temp file → fsync → rename → fsync parent dir.
    // Prevents torn JSON if the process crashes mid-write.
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const payload = JSON.stringify(sessions, null, 2);

    const tmpFd = openSync(tmpPath, 'w');
    try {
      try {
        writeFileSync(tmpFd, payload, 'utf-8');
        fsyncSync(tmpFd);
      } finally {
        closeSync(tmpFd);
      }
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      // If anything before/at the rename fails, clean up the temp file so we
      // don't leave .tmp.<pid>.<ts> litter in the config dir. The real store
      // is untouched (rename never happened).
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best-effort: temp file may already be gone.
      }
      throw err;
    }

    // Fsync the parent directory so the rename is durable across crashes.
    // Not supported on Windows; ignore EPERM/EISDIR there.
    try {
      const dirFd = openSync(dir, 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Best-effort: directory fsync isn't available on every platform.
    }
  }

  get(id: string): RelaySession | null {
    return this.load().find((session) => session.id === id) ?? null;
  }

  list(): RelaySession[] {
    return this.load();
  }

  /** Remove a single session by label. Returns true if a row was removed. */
  delete(id: string): boolean {
    const sessions = this.load();
    const filtered = sessions.filter((session) => session.id !== id);
    if (filtered.length === sessions.length) return false;
    this.save(filtered);
    return true;
  }

  /** Drop sessions whose `lastUsedAt` is older than `cutoff`. Returns the IDs removed. */
  pruneOlderThan(cutoff: Date): string[] {
    const sessions = this.load();
    const cutoffIso = cutoff.toISOString();
    const removed = sessions.filter((s) => s.lastUsedAt < cutoffIso).map((s) => s.id);
    if (removed.length === 0) return [];
    const kept = sessions.filter((s) => s.lastUsedAt >= cutoffIso);
    this.save(kept);
    return removed;
  }

  /** Drop every session. Returns the count removed. */
  clear(): number {
    const sessions = this.load();
    if (sessions.length === 0) return 0;
    this.save([]);
    return sessions.length;
  }

  upsert(opts: {
    id: string;
    backend: string;
    repoPath: string;
    backendSessionId?: string;
    /** Append entries to the existing history. Mutually exclusive with `replaceHistory`. */
    historyAppend?: SessionHistoryEntry[];
    /** Replace the existing history entirely (e.g. clear it with []).
     *  Mutually exclusive with `historyAppend`. */
    replaceHistory?: SessionHistoryEntry[];
  }): RelaySession {
    if (opts.historyAppend !== undefined && opts.replaceHistory !== undefined) {
      throw new Error('upsert: historyAppend and replaceHistory are mutually exclusive');
    }

    const sessions = this.load();
    const now = new Date().toISOString();
    const existing = sessions.find((session) => session.id === opts.id);

    if (existing) {
      existing.backend = opts.backend;
      existing.repoPath = opts.repoPath;
      if (opts.backendSessionId) {
        existing.backendSessionId = opts.backendSessionId;
      }
      if (opts.replaceHistory !== undefined) {
        existing.history = [...opts.replaceHistory];
      } else if (opts.historyAppend?.length) {
        existing.history.push(...opts.historyAppend);
      }
      existing.lastUsedAt = now;
      this.save(sessions);
      return existing;
    }

    const initialHistory = opts.replaceHistory !== undefined
      ? [...opts.replaceHistory]
      : [...(opts.historyAppend ?? [])];

    const session: RelaySession = {
      id: opts.id,
      backend: opts.backend,
      backendSessionId: opts.backendSessionId,
      repoPath: opts.repoPath,
      history: initialHistory,
      createdAt: now,
      lastUsedAt: now,
    };
    sessions.push(session);

    if (sessions.length > MAX_SESSIONS) {
      const sorted = [...sessions].sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
      this.save(sorted.slice(sorted.length - MAX_SESSIONS));
      return session;
    }

    this.save(sessions);
    return session;
  }
}

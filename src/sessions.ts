/** Relay sessions with transactional SQLite persistence and one-time JSON import. */
import { readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
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
  private dbPath: string;
  private db?: Database.Database;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
      'phone-a-friend',
      'sessions.json',
    );
    this.dbPath = this.filePath.endsWith('.json') ? this.filePath.slice(0, -5) + '.db' : this.filePath + '.db';
  }

  private transaction<T>(operation: () => T): T {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    // Keep the native addon lazy so help and version work without loading it.
    const Sqlite = require('better-sqlite3') as typeof Database;
    const db = new Sqlite(this.dbPath, { timeout: 5000 });
    try {
      return db.transaction(() => {
        this.db = db;
        db.exec('CREATE TABLE IF NOT EXISTS relay_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS migration (id INTEGER PRIMARY KEY)');
        if (!db.prepare('SELECT id FROM migration WHERE id = 1').get()) {
          this.save(this.loadLegacy());
          db.prepare('INSERT INTO migration (id) VALUES (1)').run();
        }
        return operation();
      }).immediate();
    } finally {
      this.db = undefined;
      db.close();
    }
  }

  private load(): RelaySession[] {
    const rows = this.db!.prepare('SELECT payload FROM relay_sessions ORDER BY rowid').all() as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as RelaySession);
  }

  private loadLegacy(): RelaySession[] {
    if (!existsSync(this.filePath)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      console.error(`[phone-a-friend] Failed to read session store ${this.filePath}: ${(err as Error).message}`);
      throw err;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('session store is not a JSON array');
      }
      for (const row of parsed) {
        if (!row || typeof row.id !== 'string' || typeof row.backend !== 'string'
          || typeof row.repoPath !== 'string' || !Array.isArray(row.history)
          || typeof row.createdAt !== 'string' || typeof row.lastUsedAt !== 'string') {
          throw new Error('invalid session record');
        }
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
            `and could not be rotated (${(rotateErr as Error).message}). Migration has been aborted.`,
        );
        throw rotateErr;
      }
      return [];
    }
  }

  private save(sessions: RelaySession[]): void {
    this.db!.prepare('DELETE FROM relay_sessions').run();
    const insert = this.db!.prepare('INSERT INTO relay_sessions (id, payload) VALUES (?, ?)');
    for (const session of sessions) insert.run(session.id, JSON.stringify(session));
  }

  get(id: string): RelaySession | null {
    return this.transaction(() => this.load().find((session) => session.id === id) ?? null);
  }

  list(): RelaySession[] {
    return this.transaction(() => this.load());
  }

  /** Remove a single session by label. Returns true if a row was removed. */
  delete(id: string): boolean {
    return this.transaction(() => {
      const sessions = this.load();
      const filtered = sessions.filter((session) => session.id !== id);
      if (filtered.length === sessions.length) return false;
      this.save(filtered);
      return true;
    });
  }

  /** Drop sessions whose `lastUsedAt` is older than `cutoff`. Returns the IDs removed. */
  pruneOlderThan(cutoff: Date): string[] {
    return this.transaction(() => {
      const sessions = this.load();
      const cutoffIso = cutoff.toISOString();
      const removed = sessions.filter((s) => s.lastUsedAt < cutoffIso).map((s) => s.id);
      if (removed.length === 0) return [];
      const kept = sessions.filter((s) => s.lastUsedAt >= cutoffIso);
      this.save(kept);
      return removed;
    });
  }

  /** Drop every session. Returns the count removed. */
  clear(): number {
    return this.transaction(() => {
      const sessions = this.load();
      if (sessions.length === 0) return 0;
      this.save([]);
      return sessions.length;
    });
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

    return this.transaction(() => {
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
    });
  }
}

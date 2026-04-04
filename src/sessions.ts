/**
 * Relay session store with JSON file persistence.
 *
 * Stores up to 100 sessions at ~/.config/phone-a-friend/sessions.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private save(sessions: RelaySession[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(sessions, null, 2), 'utf-8');
  }

  get(id: string): RelaySession | null {
    return this.load().find((session) => session.id === id) ?? null;
  }

  list(): RelaySession[] {
    return this.load();
  }

  upsert(opts: {
    id: string;
    backend: string;
    repoPath: string;
    backendSessionId?: string;
    historyAppend?: SessionHistoryEntry[];
  }): RelaySession {
    const sessions = this.load();
    const now = new Date().toISOString();
    const existing = sessions.find((session) => session.id === opts.id);

    if (existing) {
      existing.backend = opts.backend;
      existing.repoPath = opts.repoPath;
      if (opts.backendSessionId) {
        existing.backendSessionId = opts.backendSessionId;
      }
      if (opts.historyAppend?.length) {
        existing.history.push(...opts.historyAppend);
      }
      existing.lastUsedAt = now;
      this.save(sessions);
      return existing;
    }

    const session: RelaySession = {
      id: opts.id,
      backend: opts.backend,
      backendSessionId: opts.backendSessionId,
      repoPath: opts.repoPath,
      history: [...(opts.historyAppend ?? [])],
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

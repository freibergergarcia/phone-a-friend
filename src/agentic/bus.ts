/**
 * SQLite transcript bus — append-only conversation log for agentic sessions.
 *
 * NOT a runtime queue. The in-memory MessageQueue handles routing.
 * This stores the complete transcript for: logs, replay, web dashboard.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type {
  AgenticSession,
  AgentState,
  Message,
  SessionStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    max_turns INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS agents (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    name TEXT NOT NULL,
    backend TEXT NOT NULL,
    model TEXT,
    backend_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    message_count INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT,
    PRIMARY KEY (session_id, name)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    turn INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, turn);
  CREATE INDEX IF NOT EXISTS idx_messages_routing
    ON messages(session_id, to_agent);
`;

// ---------------------------------------------------------------------------
// Default DB path
// ---------------------------------------------------------------------------

export function defaultDbPath(): string {
  const configBase = process.env.XDG_CONFIG_HOME
    ?? join(homedir(), '.config');
  const dir = join(configBase, 'phone-a-friend');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'agentic.db');
}

// ---------------------------------------------------------------------------
// TranscriptBus
// ---------------------------------------------------------------------------

export class TranscriptBus {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? defaultDbPath());
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Idempotent schema migrations for existing databases.
   */
  private migrate(): void {
    const columns = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    const hasMaxTurns = columns.some((c) => c.name === 'max_turns');
    if (!hasMaxTurns) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 0');
    }
  }

  // ---- Sessions -----------------------------------------------------------

  createSession(id: string, prompt: string, maxTurns = 0): void {
    this.db.prepare(
      'INSERT INTO sessions (id, prompt, max_turns) VALUES (?, ?, ?)',
    ).run(id, prompt, maxTurns);
  }

  endSession(id: string, status: SessionStatus): void {
    this.db.prepare(
      `UPDATE sessions SET status = ?, ended_at = datetime('now') WHERE id = ?`,
    ).run(status, id);
  }

  getSession(id: string): AgenticSession | null {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?',
    ).get(id) as SessionRow | undefined;
    if (!row) return null;

    const agents = this.getAgents(id);
    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      prompt: row.prompt,
      status: row.status as SessionStatus,
      agents,
      turn: this.getMaxTurn(id),
      maxTurns: row.max_turns ?? 0,
    };
  }

  listSessions(): AgenticSession[] {
    const rows = this.db.prepare(
      'SELECT * FROM sessions ORDER BY rowid DESC',
    ).all() as SessionRow[];

    return rows.map((row) => ({
      id: row.id,
      createdAt: new Date(row.created_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      prompt: row.prompt,
      status: row.status as SessionStatus,
      agents: this.getAgents(row.id),
      turn: this.getMaxTurn(row.id),
      maxTurns: row.max_turns ?? 0,
    }));
  }

  // ---- Agents -------------------------------------------------------------

  addAgent(
    sessionId: string,
    name: string,
    backend: string,
    model?: string,
  ): void {
    this.db.prepare(
      'INSERT INTO agents (session_id, name, backend, model) VALUES (?, ?, ?, ?)',
    ).run(sessionId, name, backend, model ?? null);
  }

  updateAgent(
    sessionId: string,
    name: string,
    updates: Partial<Pick<AgentState, 'status' | 'backendSessionId' | 'messageCount'>>,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.backendSessionId !== undefined) {
      sets.push('backend_session_id = ?');
      values.push(updates.backendSessionId);
    }
    if (updates.messageCount !== undefined) {
      sets.push('message_count = ?');
      values.push(updates.messageCount);
    }

    sets.push(`last_seen = datetime('now')`);
    values.push(sessionId, name);

    this.db.prepare(
      `UPDATE agents SET ${sets.join(', ')} WHERE session_id = ? AND name = ?`,
    ).run(...values);
  }

  getAgents(sessionId: string): AgentState[] {
    const rows = this.db.prepare(
      'SELECT * FROM agents WHERE session_id = ? ORDER BY rowid',
    ).all(sessionId) as AgentRow[];

    return rows.map((row) => ({
      name: row.name,
      backend: row.backend,
      model: row.model ?? undefined,
      backendSessionId: row.backend_session_id ?? undefined,
      status: row.status as AgentState['status'],
      messageCount: row.message_count,
      lastSeen: row.last_seen ? new Date(row.last_seen) : undefined,
    }));
  }

  // ---- Messages -----------------------------------------------------------

  appendMessage(msg: Omit<Message, 'id' | 'timestamp'>): number {
    const insertAndCount = this.db.transaction(() => {
      const result = this.db.prepare(
        'INSERT INTO messages (session_id, from_agent, to_agent, content, turn) VALUES (?, ?, ?, ?, ?)',
      ).run(msg.sessionId, msg.from, msg.to, msg.content, msg.turn);

      // Increment sender's message count
      this.db.prepare(
        'UPDATE agents SET message_count = message_count + 1 WHERE session_id = ? AND name = ?',
      ).run(msg.sessionId, msg.from);

      return result.lastInsertRowid as number;
    });
    return insertAndCount();
  }

  getTranscript(sessionId: string): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY turn, id',
    ).all(sessionId) as MessageRow[];

    return rows.map(rowToMessage);
  }

  getMessageCount(sessionId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE session_id = ?',
    ).get(sessionId) as { count: number };
    return row.count;
  }

  // ---- Cleanup ------------------------------------------------------------

  deleteSession(id: string): void {
    const deleteAll = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    });
    deleteAll();
  }

  close(): void {
    this.db.close();
  }

  // ---- Internal -----------------------------------------------------------

  private getMaxTurn(sessionId: string): number {
    const row = this.db.prepare(
      'SELECT MAX(turn) as max_turn FROM messages WHERE session_id = ?',
    ).get(sessionId) as { max_turn: number | null };
    return row.max_turn ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Row types (SQLite → TS mapping)
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  created_at: string;
  ended_at: string | null;
  prompt: string;
  status: string;
  max_turns: number;
}

interface AgentRow {
  session_id: string;
  name: string;
  backend: string;
  model: string | null;
  backend_session_id: string | null;
  status: string;
  message_count: number;
  last_seen: string | null;
}

interface MessageRow {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  content: string;
  timestamp: string;
  turn: number;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    from: row.from_agent,
    to: row.to_agent,
    content: row.content,
    timestamp: new Date(row.timestamp),
    turn: row.turn,
  };
}

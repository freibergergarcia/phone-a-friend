/**
 * Shared SQLite store initialisation with retry.
 *
 * Several PaF processes can open a brand-new store at the same time (two
 * relays started together, `task list` in another terminal, CI). Switching a
 * fresh database to WAL needs an exclusive lock, and SQLite returns
 * SQLITE_BUSY for that switch without consulting the busy handler, so the
 * usual `busy_timeout` does not help (issue #173: 6 of 60 concurrent first
 * opens failed). Retrying the whole initialisation with a short jittered
 * backoff brought that to 0 of 160 in the reporter's measurements.
 *
 * Callers pass the pragmas and schema as `init`; every failed attempt closes
 * its handle before the next one opens a fresh connection.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SqliteHandle = import('better-sqlite3').Database;

// Lazy-load better-sqlite3 (native addon can't be bundled by tsup).
let _Database: typeof import('better-sqlite3') | null = null;
function getDatabase(): typeof import('better-sqlite3') {
  if (!_Database) {
    _Database = require('better-sqlite3');
  }
  return _Database!;
}

export interface OpenDatabaseOptions {
  /** Attempts before the last error is rethrown. Default 20. */
  maxAttempts?: number;
  /** Inclusive [min, max] sleep between attempts in ms. Default [25, 75]. */
  delayMs?: [number, number];
  /** Connection factory; only tests replace it, to force open-time contention. */
  open?: (path: string) => SqliteHandle;
}

/**
 * better-sqlite3 reports extended result codes as their names, e.g.
 * SQLITE_BUSY_SNAPSHOT or SQLITE_LOCKED_SHAREDCACHE. Every BUSY and LOCKED
 * variant means another connection holds a lock, so match on the base code.
 */
export function isLockContention(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_')
    || code === 'SQLITE_LOCKED' || code.startsWith('SQLITE_LOCKED_'));
}

/** Synchronous sleep: the store constructors are synchronous. */
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Open `path` (creating its directory) and run `init` on the connection,
 * retrying the pair on lock contention. Any other error propagates at once.
 */
export function openDatabase(
  path: string,
  init: (db: SqliteHandle) => void,
  opts: OpenDatabaseOptions = {},
): SqliteHandle {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 20);
  const [minDelay, maxDelay] = opts.delayMs ?? [25, 75];
  mkdirSync(dirname(path), { recursive: true });
  const open = opts.open ?? ((p: string) => new (getDatabase())(p));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Opening the file can itself report contention, so it is inside the
    // retry boundary; only a handle that was actually created gets closed.
    let db: SqliteHandle | null = null;
    try {
      db = open(path);
      init(db);
      return db;
    } catch (err) {
      if (db) {
        try { db.close(); } catch { /* the handle is being discarded */ }
      }
      if (!isLockContention(err)) throw err;
      lastError = err;
      if (attempt < maxAttempts) {
        sleepSync(minDelay + Math.random() * Math.max(0, maxDelay - minDelay));
      }
    }
  }
  throw lastError;
}

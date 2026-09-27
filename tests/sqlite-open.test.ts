import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLockContention, openDatabase, type SqliteHandle } from '../src/sqlite-open.js';

function busy(code = 'SQLITE_BUSY'): Error & { code: string } {
  return Object.assign(new Error(`${code}: database is locked`), { code });
}

/**
 * Issue #173: several PaF processes opening a brand-new tasks.db at once fail
 * on `PRAGMA journal_mode = WAL` with SQLITE_BUSY, which the busy timeout does
 * not cover. openDatabase retries the whole initialisation (open + init
 * callback) with jittered backoff and closes every failed handle.
 */
describe('openDatabase()', () => {
  function tempDb(): string {
    const dir = mkdtempSync(join(tmpdir(), 'paf-sqlite-open-'));
    return join(dir, 'store.db');
  }

  it('opens once and runs init when nothing contends', () => {
    const path = tempDb();
    const init = vi.fn((db: SqliteHandle) => { db.pragma('journal_mode = WAL'); });
    const db = openDatabase(path, init);
    expect(init).toHaveBeenCalledTimes(1);
    expect(db.open).toBe(true);
    db.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  });

  it.each(['SQLITE_BUSY', 'SQLITE_LOCKED'])('retries the full init on %s and closes each failed handle', (code) => {
    const path = tempDb();
    const handles: SqliteHandle[] = [];
    let attempts = 0;
    const init = (db: SqliteHandle) => {
      handles.push(db);
      attempts += 1;
      if (attempts < 3) throw busy(code);
      db.pragma('journal_mode = WAL');
    };
    const db = openDatabase(path, init, { maxAttempts: 5, delayMs: [0, 1] });
    expect(attempts).toBe(3);
    expect(handles).toHaveLength(3);
    expect(handles[0].open).toBe(false);
    expect(handles[1].open).toBe(false);
    expect(handles[2]).toBe(db);
    expect(db.open).toBe(true);
    db.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  });

  it('gives up after the attempt budget and rethrows the last error', () => {
    const path = tempDb();
    const handles: SqliteHandle[] = [];
    const init = (db: SqliteHandle) => { handles.push(db); throw busy(); };
    expect(() => openDatabase(path, init, { maxAttempts: 4, delayMs: [0, 1] })).toThrow(/database is locked/);
    expect(handles).toHaveLength(4);
    expect(handles.every((h) => h.open === false)).toBe(true);
    rmSync(join(path, '..'), { recursive: true, force: true });
  });

  it('treats extended BUSY and LOCKED result codes as contention', () => {
    for (const code of ['SQLITE_BUSY', 'SQLITE_BUSY_RECOVERY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_BUSY_TIMEOUT', 'SQLITE_LOCKED', 'SQLITE_LOCKED_SHAREDCACHE']) {
      expect(isLockContention(busy(code))).toBe(true);
    }
    for (const code of ['SQLITE_CORRUPT', 'SQLITE_CANTOPEN', 'SQLITE_IOERR_LOCK', 'ENOENT']) {
      expect(isLockContention(busy(code))).toBe(false);
    }
    expect(isLockContention(new Error('no code'))).toBe(false);
  });

  it('retries when opening the file itself reports contention', () => {
    const path = tempDb();
    let opens = 0;
    const Database = require('better-sqlite3');
    const open = (p: string) => {
      opens += 1;
      if (opens < 3) throw busy('SQLITE_BUSY');
      return new Database(p);
    };
    const init = vi.fn((db: SqliteHandle) => { db.pragma('journal_mode = WAL'); });
    const db = openDatabase(path, init, { open, maxAttempts: 5, delayMs: [0, 1] });
    expect(opens).toBe(3);
    expect(init).toHaveBeenCalledTimes(1);
    expect(db.open).toBe(true);
    db.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  });

  it('does not retry errors that are not lock contention', () => {
    const path = tempDb();
    const init = vi.fn(() => { throw new Error('SQLITE_CORRUPT: malformed'); });
    expect(() => openDatabase(path, init, { maxAttempts: 4, delayMs: [0, 1] })).toThrow(/malformed/);
    expect(init).toHaveBeenCalledTimes(1);
    rmSync(join(path, '..'), { recursive: true, force: true });
  });
});

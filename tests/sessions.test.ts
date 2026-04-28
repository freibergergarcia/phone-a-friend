import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/sessions.js';

describe('SessionStore', () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paf-sessions-'));
    store = new SessionStore(join(tmpDir, 'sessions.json'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new session on first upsert', () => {
    const session = store.upsert({
      id: 'codex-review',
      backend: 'codex',
      repoPath: '/tmp/repo',
      backendSessionId: 'thread-1',
      historyAppend: [{ role: 'user', content: 'hello' }],
    });

    expect(session.id).toBe('codex-review');
    expect(session.backendSessionId).toBe('thread-1');
    expect(session.history).toHaveLength(1);
  });

  it('updates an existing session and appends history', () => {
    store.upsert({
      id: 'gemini-review',
      backend: 'gemini',
      repoPath: '/tmp/repo',
      backendSessionId: 'sess-1',
      historyAppend: [{ role: 'user', content: 'first' }],
    });

    const session = store.upsert({
      id: 'gemini-review',
      backend: 'gemini',
      repoPath: '/tmp/repo',
      backendSessionId: 'sess-2',
      historyAppend: [{ role: 'assistant', content: 'reply' }],
    });

    expect(session.backendSessionId).toBe('sess-2');
    expect(session.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('persists sessions across instances', () => {
    const path = join(tmpDir, 'sessions.json');
    const first = new SessionStore(path);
    first.upsert({
      id: 'claude-fix',
      backend: 'claude',
      repoPath: '/tmp/repo',
      backendSessionId: 'uuid-1',
    });

    const second = new SessionStore(path);
    expect(second.get('claude-fix')?.backendSessionId).toBe('uuid-1');
  });

  it('returns null for unknown session id', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  it('lists all sessions', () => {
    store.upsert({ id: 'a', backend: 'codex', repoPath: '/tmp' });
    store.upsert({ id: 'b', backend: 'claude', repoPath: '/tmp' });
    expect(store.list()).toHaveLength(2);
  });

  it('prunes oldest sessions beyond max limit', () => {
    for (let i = 0; i < 105; i++) {
      store.upsert({ id: `session-${i}`, backend: 'codex', repoPath: '/tmp' });
    }
    expect(store.list().length).toBeLessThanOrEqual(100);
  });

  // --- replaceHistory ---

  it('replaceHistory clears the existing history on an existing row', () => {
    store.upsert({
      id: 'fat-row',
      backend: 'codex',
      repoPath: '/tmp/repo',
      historyAppend: [
        { role: 'user', content: 'old 1' },
        { role: 'assistant', content: 'old 2' },
      ],
    });

    const updated = store.upsert({
      id: 'fat-row',
      backend: 'codex',
      repoPath: '/tmp/repo',
      replaceHistory: [],
    });

    expect(updated.history).toHaveLength(0);
    expect(store.get('fat-row')?.history).toHaveLength(0);
  });

  it('replaceHistory replaces with arbitrary contents', () => {
    store.upsert({
      id: 'row',
      backend: 'codex',
      repoPath: '/tmp',
      historyAppend: [{ role: 'user', content: 'old' }],
    });

    const updated = store.upsert({
      id: 'row',
      backend: 'codex',
      repoPath: '/tmp',
      replaceHistory: [{ role: 'user', content: 'new' }],
    });

    expect(updated.history).toEqual([{ role: 'user', content: 'new' }]);
  });

  it('throws when historyAppend and replaceHistory are both set', () => {
    expect(() =>
      store.upsert({
        id: 'row',
        backend: 'codex',
        repoPath: '/tmp',
        historyAppend: [{ role: 'user', content: 'a' }],
        replaceHistory: [{ role: 'user', content: 'b' }],
      }),
    ).toThrow(/mutually exclusive/);
  });

  // --- delete / prune / clear ---

  it('delete removes a single row and reports whether it existed', () => {
    store.upsert({ id: 'a', backend: 'codex', repoPath: '/tmp' });
    store.upsert({ id: 'b', backend: 'codex', repoPath: '/tmp' });

    expect(store.delete('a')).toBe(true);
    expect(store.delete('a')).toBe(false);
    expect(store.list().map((s) => s.id)).toEqual(['b']);
  });

  it('pruneOlderThan drops rows older than the cutoff and returns their ids', () => {
    const old = store.upsert({ id: 'old', backend: 'codex', repoPath: '/tmp' });
    // Backdate the lastUsedAt by manipulating the file directly.
    const path = join(tmpDir, 'sessions.json');
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    data[0].lastUsedAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(path, JSON.stringify(data));

    store.upsert({ id: 'fresh', backend: 'codex', repoPath: '/tmp' });

    const removed = store.pruneOlderThan(new Date('2024-01-01T00:00:00.000Z'));
    expect(removed).toEqual([old.id]);
    expect(store.list().map((s) => s.id)).toEqual(['fresh']);
  });

  it('pruneOlderThan returns empty when nothing to remove', () => {
    store.upsert({ id: 'fresh', backend: 'codex', repoPath: '/tmp' });
    const removed = store.pruneOlderThan(new Date('2000-01-01T00:00:00.000Z'));
    expect(removed).toEqual([]);
  });

  it('clear removes every row and returns the count', () => {
    store.upsert({ id: 'a', backend: 'codex', repoPath: '/tmp' });
    store.upsert({ id: 'b', backend: 'codex', repoPath: '/tmp' });
    expect(store.clear()).toBe(2);
    expect(store.list()).toEqual([]);
    expect(store.clear()).toBe(0);
  });

  // --- corrupt-file rotation ---

  describe('corrupt-file handling', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      stderrSpy.mockRestore();
    });

    it('rotates a corrupt file to .corrupt-<ts> and starts fresh', () => {
      const path = join(tmpDir, 'sessions.json');
      writeFileSync(path, '{ this is not valid JSON', 'utf-8');

      const fresh = new SessionStore(path);
      expect(fresh.list()).toEqual([]);

      const rotated = readdirSync(tmpDir).filter((f) => f.startsWith('sessions.json.corrupt-'));
      expect(rotated).toHaveLength(1);
      expect(existsSync(path)).toBe(false);
      expect(stderrSpy).toHaveBeenCalled();
      expect(stderrSpy.mock.calls[0][0]).toContain('could not be parsed');
    });

    it('rotates non-array JSON (schema break) the same way', () => {
      const path = join(tmpDir, 'sessions.json');
      writeFileSync(path, '{"not":"an array"}', 'utf-8');

      const fresh = new SessionStore(path);
      expect(fresh.list()).toEqual([]);

      const rotated = readdirSync(tmpDir).filter((f) => f.startsWith('sessions.json.corrupt-'));
      expect(rotated).toHaveLength(1);
      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  // --- atomic write ---

  it('does not leave a tmp file behind on successful save', () => {
    store.upsert({ id: 'a', backend: 'codex', repoPath: '/tmp' });
    const stragglers = readdirSync(tmpDir).filter((f) => f.includes('.tmp.'));
    expect(stragglers).toEqual([]);
  });
});

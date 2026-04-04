import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
});

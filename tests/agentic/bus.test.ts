/**
 * Tests for agentic transcript bus (SQLite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TranscriptBus } from '../../src/agentic/bus.js';

describe('TranscriptBus', () => {
  let bus: TranscriptBus;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentic-test-'));
    bus = new TranscriptBus(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    bus.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- Sessions -----------------------------------------------------------

  describe('sessions', () => {
    it('creates and retrieves a session', () => {
      bus.createSession('sess-1', 'Review auth module');
      const session = bus.getSession('sess-1');

      expect(session).not.toBeNull();
      expect(session!.id).toBe('sess-1');
      expect(session!.prompt).toBe('Review auth module');
      expect(session!.status).toBe('active');
      expect(session!.endedAt).toBeUndefined();
    });

    it('ends a session', () => {
      bus.createSession('sess-1', 'test');
      bus.endSession('sess-1', 'completed');

      const session = bus.getSession('sess-1');
      expect(session!.status).toBe('completed');
      expect(session!.endedAt).toBeDefined();
    });

    it('lists sessions in reverse chronological order', () => {
      bus.createSession('sess-1', 'first');
      bus.createSession('sess-2', 'second');

      const sessions = bus.listSessions();
      expect(sessions).toHaveLength(2);
      // Most recent first
      expect(sessions[0].id).toBe('sess-2');
      expect(sessions[1].id).toBe('sess-1');
    });

    it('returns null for unknown session', () => {
      expect(bus.getSession('nonexistent')).toBeNull();
    });
  });

  // ---- Agents -------------------------------------------------------------

  describe('agents', () => {
    beforeEach(() => {
      bus.createSession('sess-1', 'test');
    });

    it('adds and retrieves agents', () => {
      bus.addAgent('sess-1', 'security', 'claude', 'opus');
      bus.addAgent('sess-1', 'perf', 'gemini');

      const agents = bus.getAgents('sess-1');
      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('security');
      expect(agents[0].backend).toBe('claude');
      expect(agents[0].model).toBe('opus');
      expect(agents[1].name).toBe('perf');
      expect(agents[1].model).toBeUndefined();
    });

    it('uses composite key (session_id, name)', () => {
      bus.createSession('sess-2', 'another test');
      bus.addAgent('sess-1', 'security', 'claude');
      bus.addAgent('sess-2', 'security', 'gemini');

      const agents1 = bus.getAgents('sess-1');
      const agents2 = bus.getAgents('sess-2');

      expect(agents1).toHaveLength(1);
      expect(agents1[0].backend).toBe('claude');
      expect(agents2).toHaveLength(1);
      expect(agents2[0].backend).toBe('gemini');
    });

    it('updates agent status', () => {
      bus.addAgent('sess-1', 'security', 'claude');
      bus.updateAgent('sess-1', 'security', { status: 'dead' });

      const agents = bus.getAgents('sess-1');
      expect(agents[0].status).toBe('dead');
    });

    it('updates backend session ID', () => {
      bus.addAgent('sess-1', 'security', 'claude');
      bus.updateAgent('sess-1', 'security', { backendSessionId: 'uuid-123' });

      const agents = bus.getAgents('sess-1');
      expect(agents[0].backendSessionId).toBe('uuid-123');
    });
  });

  // ---- Messages -----------------------------------------------------------

  describe('messages', () => {
    beforeEach(() => {
      bus.createSession('sess-1', 'test');
      bus.addAgent('sess-1', 'security', 'claude');
      bus.addAgent('sess-1', 'perf', 'gemini');
    });

    it('appends and retrieves messages in order', () => {
      bus.appendMessage({
        sessionId: 'sess-1',
        from: 'user',
        to: 'security',
        content: 'Review auth',
        turn: 0,
      });
      bus.appendMessage({
        sessionId: 'sess-1',
        from: 'security',
        to: 'perf',
        content: 'Found N+1 query',
        turn: 1,
      });

      const transcript = bus.getTranscript('sess-1');
      expect(transcript).toHaveLength(2);
      expect(transcript[0].from).toBe('user');
      expect(transcript[0].turn).toBe(0);
      expect(transcript[1].from).toBe('security');
      expect(transcript[1].turn).toBe(1);
    });

    it('increments sender message count', () => {
      bus.appendMessage({
        sessionId: 'sess-1',
        from: 'security',
        to: 'perf',
        content: 'msg 1',
        turn: 0,
      });
      bus.appendMessage({
        sessionId: 'sess-1',
        from: 'security',
        to: 'perf',
        content: 'msg 2',
        turn: 1,
      });

      const agents = bus.getAgents('sess-1');
      const security = agents.find((a) => a.name === 'security');
      expect(security!.messageCount).toBe(2);
    });

    it('counts messages per session', () => {
      bus.appendMessage({ sessionId: 'sess-1', from: 'user', to: 'security', content: 'a', turn: 0 });
      bus.appendMessage({ sessionId: 'sess-1', from: 'security', to: 'perf', content: 'b', turn: 1 });

      expect(bus.getMessageCount('sess-1')).toBe(2);
    });

    it('keeps messages scoped to session', () => {
      bus.createSession('sess-2', 'other');
      bus.addAgent('sess-2', 'quality', 'codex');

      bus.appendMessage({ sessionId: 'sess-1', from: 'security', to: 'perf', content: 'a', turn: 0 });
      bus.appendMessage({ sessionId: 'sess-2', from: 'quality', to: 'user', content: 'b', turn: 0 });

      expect(bus.getTranscript('sess-1')).toHaveLength(1);
      expect(bus.getTranscript('sess-2')).toHaveLength(1);
    });
  });

  // ---- Cleanup ------------------------------------------------------------

  describe('cleanup', () => {
    it('deletes a session and all its data', () => {
      bus.createSession('sess-1', 'test');
      bus.addAgent('sess-1', 'security', 'claude');
      bus.appendMessage({ sessionId: 'sess-1', from: 'user', to: 'security', content: 'hi', turn: 0 });

      bus.deleteSession('sess-1');

      expect(bus.getSession('sess-1')).toBeNull();
      expect(bus.getAgents('sess-1')).toHaveLength(0);
      expect(bus.getTranscript('sess-1')).toHaveLength(0);
    });
  });
});

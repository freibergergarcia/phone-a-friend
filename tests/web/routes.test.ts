/**
 * Tests for REST API route handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Mock better-sqlite3 (transitive dep via bus import)
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import { handleApiRoute } from '../../src/web/routes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockReq = EventEmitter & Partial<IncomingMessage> & { destroy: ReturnType<typeof vi.fn> };
type MockRes = EventEmitter & {
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  statusCode: number;
  _body: string;
  _headers: Record<string, string>;
};

function makeReq(method: string, url: string): MockReq {
  const req = new EventEmitter() as MockReq;
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:7777' };
  req.destroy = vi.fn();
  return req;
}

function makeRes(): MockRes {
  const res = new EventEmitter() as MockRes;
  res.statusCode = 200;
  res._body = '';
  res._headers = {};
  res.writeHead = vi.fn((status: number, headers?: Record<string, string>) => {
    res.statusCode = status;
    if (headers) Object.assign(res._headers, headers);
    return res;
  });
  res.write = vi.fn((data: string) => {
    res._body += data;
    return true;
  });
  res.end = vi.fn((data?: string) => {
    if (data) res._body += data;
  });
  return res;
}

function parseResBody(res: MockRes): unknown {
  const bodyArg = (res.end as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  return bodyArg ? JSON.parse(bodyArg) : undefined;
}

function makeBus(overrides: Record<string, unknown> = {}) {
  return {
    listSessions: vi.fn().mockReturnValue([]),
    getSession: vi.fn().mockReturnValue(null),
    getTranscript: vi.fn().mockReturnValue([]),
    deleteSession: vi.fn(),
    ...overrides,
  } as never;
}

function makeSse(overrides: Record<string, unknown> = {}) {
  return {
    addClient: vi.fn().mockReturnValue(() => {}),
    broadcast: vi.fn(),
    clientCount: 0,
    ...overrides,
  } as never;
}

// Helper to emit body data on a request
function sendBody(req: MockReq, body: string): void {
  setTimeout(() => {
    req.emit('data', Buffer.from(body));
    req.emit('end');
  }, 1);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleApiRoute', () => {
  let bus: ReturnType<typeof makeBus>;
  let sse: ReturnType<typeof makeSse>;

  beforeEach(() => {
    bus = makeBus();
    sse = makeSse();
  });

  // ---- Return value / routing -------------------------------------------

  describe('routing', () => {
    it('returns false for non-API paths', () => {
      const req = makeReq('GET', '/index.html');
      const res = makeRes();
      expect(handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse)).toBe(false);
    });

    it('returns false for /api-adjacent path that does not match', () => {
      const req = makeReq('GET', '/api-v2/sessions');
      const res = makeRes();
      expect(handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse)).toBe(false);
    });

    it('returns true for all known API routes', () => {
      const routes = [
        { method: 'OPTIONS', url: '/api/sessions' },
        { method: 'GET', url: '/api/sessions' },
        { method: 'GET', url: '/api/sessions/abc123' },
        { method: 'DELETE', url: '/api/sessions/abc123' },
        { method: 'GET', url: '/api/events' },
        { method: 'GET', url: '/api/stats' },
      ];
      for (const { method, url } of routes) {
        const req = makeReq(method, url);
        const res = makeRes();
        expect(handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse)).toBe(true);
      }
    });
  });

  // ---- CORS preflight ---------------------------------------------------

  describe('CORS preflight (OPTIONS)', () => {
    it('returns 204 with CORS headers', () => {
      const req = makeReq('OPTIONS', '/api/sessions');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(res.writeHead).toHaveBeenCalledWith(204, expect.objectContaining({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }));
      expect(res.end).toHaveBeenCalled();
    });

    it('returns true', () => {
      const req = makeReq('OPTIONS', '/anything');
      const res = makeRes();
      expect(handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse)).toBe(true);
    });
  });

  // ---- POST /api/ingest -------------------------------------------------

  describe('POST /api/ingest', () => {
    it('broadcasts each event via sse.broadcast()', async () => {
      const req = makeReq('POST', '/api/ingest');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      const events = [{ type: 'message', sessionId: 's1' }, { type: 'message', sessionId: 's2' }];
      sendBody(req, JSON.stringify(events));
      await new Promise((r) => setTimeout(r, 10));

      expect((sse as { broadcast: ReturnType<typeof vi.fn> }).broadcast).toHaveBeenCalledTimes(2);
    });

    it('responds { accepted: N } with correct count', async () => {
      const req = makeReq('POST', '/api/ingest');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      sendBody(req, JSON.stringify([{ a: 1 }, { b: 2 }, { c: 3 }]));
      await new Promise((r) => setTimeout(r, 10));

      expect(parseResBody(res)).toEqual({ accepted: 3 });
    });

    it('responds 400 for invalid JSON body', async () => {
      const req = makeReq('POST', '/api/ingest');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      sendBody(req, 'not json {{{');
      await new Promise((r) => setTimeout(r, 10));

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      expect(parseResBody(res)).toEqual({ error: 'Invalid JSON' });
    });

    it('responds 400 when body is valid JSON but not an array', async () => {
      const req = makeReq('POST', '/api/ingest');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      sendBody(req, JSON.stringify({ not: 'array' }));
      await new Promise((r) => setTimeout(r, 10));

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      expect(parseResBody(res)).toEqual({ error: 'Expected array of events' });
    });

    it('responds { accepted: 0 } for empty array', async () => {
      const req = makeReq('POST', '/api/ingest');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      sendBody(req, '[]');
      await new Promise((r) => setTimeout(r, 10));

      expect(parseResBody(res)).toEqual({ accepted: 0 });
    });

    it('responds 413 when body exceeds 1 MB limit', async () => {
      const req = makeReq('POST', '/api/ingest');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      // Send a chunk larger than 1 MB
      const bigChunk = Buffer.alloc(1024 * 1024 + 100, 'x');
      req.emit('data', bigChunk);

      expect(res.writeHead).toHaveBeenCalledWith(413, expect.any(Object));
      expect(req.destroy).toHaveBeenCalled();
    });

    it('does not process body after abort', async () => {
      const req = makeReq('POST', '/api/ingest');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      // Trigger abort
      const bigChunk = Buffer.alloc(1024 * 1024 + 100, 'x');
      req.emit('data', bigChunk);

      // Now emit end — should be a no-op
      req.emit('end');

      // writeHead should have been called only once (for 413)
      expect(res.writeHead).toHaveBeenCalledTimes(1);
    });
  });

  // ---- GET /api/sessions ------------------------------------------------

  describe('GET /api/sessions', () => {
    it('calls bus.listSessions() and returns the result', () => {
      const sessions = [{ id: 's1', status: 'completed' }];
      bus = makeBus({ listSessions: vi.fn().mockReturnValue(sessions) });
      const req = makeReq('GET', '/api/sessions');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(parseResBody(res)).toEqual(sessions);
    });

    it('includes Access-Control-Allow-Origin header', () => {
      const req = makeReq('GET', '/api/sessions');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Access-Control-Allow-Origin': '*',
      }));
    });

    it('responds 500 when bus.listSessions() throws', () => {
      bus = makeBus({ listSessions: vi.fn().mockImplementation(() => { throw new Error('DB error'); }) });
      const req = makeReq('GET', '/api/sessions');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
      expect(parseResBody(res)).toEqual({ error: 'DB error' });
    });
  });

  // ---- GET /api/sessions/:id --------------------------------------------

  describe('GET /api/sessions/:id', () => {
    it('returns merged { ...session, transcript } for existing session', () => {
      const session = { id: 'abc', status: 'completed', prompt: 'test' };
      const transcript = [{ from: 'user', to: 'reviewer', content: 'hi' }];
      bus = makeBus({
        getSession: vi.fn().mockReturnValue(session),
        getTranscript: vi.fn().mockReturnValue(transcript),
      });
      const req = makeReq('GET', '/api/sessions/abc');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      const body = parseResBody(res) as Record<string, unknown>;
      expect(body.id).toBe('abc');
      expect(body.transcript).toEqual(transcript);
    });

    it('passes the correct id from the URL path', () => {
      bus = makeBus({ getSession: vi.fn().mockReturnValue(null) });
      const req = makeReq('GET', '/api/sessions/my-session-123');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect((bus as { getSession: ReturnType<typeof vi.fn> }).getSession).toHaveBeenCalledWith('my-session-123');
    });

    it('returns 404 when session does not exist', () => {
      bus = makeBus({ getSession: vi.fn().mockReturnValue(null) });
      const req = makeReq('GET', '/api/sessions/nonexistent');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
      expect(parseResBody(res)).toEqual({ error: 'Session nonexistent not found' });
    });

    it('returns 500 when bus.getSession() throws', () => {
      bus = makeBus({ getSession: vi.fn().mockImplementation(() => { throw new Error('read error'); }) });
      const req = makeReq('GET', '/api/sessions/abc');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    });
  });

  // ---- DELETE /api/sessions/:id -----------------------------------------

  describe('DELETE /api/sessions/:id', () => {
    it('calls bus.deleteSession(id)', () => {
      const req = makeReq('DELETE', '/api/sessions/abc');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect((bus as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession).toHaveBeenCalledWith('abc');
    });

    it('returns { deleted: id }', () => {
      const req = makeReq('DELETE', '/api/sessions/abc');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(parseResBody(res)).toEqual({ deleted: 'abc' });
    });

    it('returns 500 when bus.deleteSession() throws', () => {
      bus = makeBus({ deleteSession: vi.fn().mockImplementation(() => { throw new Error('delete error'); }) });
      const req = makeReq('DELETE', '/api/sessions/abc');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    });
  });

  // ---- GET /api/events (SSE) --------------------------------------------

  describe('GET /api/events (SSE)', () => {
    it('calls sse.addClient with sessionId when ?session= param provided', () => {
      const req = makeReq('GET', '/api/events?session=abc');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect((sse as { addClient: ReturnType<typeof vi.fn> }).addClient).toHaveBeenCalledWith(res, 'abc');
    });

    it('calls sse.addClient with null when no ?session= param', () => {
      const req = makeReq('GET', '/api/events');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect((sse as { addClient: ReturnType<typeof vi.fn> }).addClient).toHaveBeenCalledWith(res, null);
    });

    it('registers cleanup on req close event', () => {
      const cleanupFn = vi.fn();
      sse = makeSse({ addClient: vi.fn().mockReturnValue(cleanupFn) });
      const req = makeReq('GET', '/api/events');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      // Simulate client disconnect
      req.emit('close');
      expect(cleanupFn).toHaveBeenCalled();
    });

    it('returns true without ending the response', () => {
      const req = makeReq('GET', '/api/events');
      const res = makeRes();
      const result = handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(result).toBe(true);
      expect(res.end).not.toHaveBeenCalled();
    });
  });

  // ---- GET /api/stats ---------------------------------------------------

  describe('GET /api/stats', () => {
    it('returns correct counts for active/completed/failed sessions', () => {
      const sessions = [
        { id: 's1', status: 'active', agents: [] },
        { id: 's2', status: 'completed', agents: [] },
        { id: 's3', status: 'completed', agents: [] },
        { id: 's4', status: 'failed', agents: [] },
      ];
      bus = makeBus({ listSessions: vi.fn().mockReturnValue(sessions) });
      sse = makeSse({ clientCount: 3 });
      const req = makeReq('GET', '/api/stats');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      const body = parseResBody(res) as Record<string, number>;
      expect(body.totalSessions).toBe(4);
      expect(body.active).toBe(1);
      expect(body.completed).toBe(2);
      expect(body.failed).toBe(1);
      expect(body.sseClients).toBe(3);
    });

    it('sums message counts across all agents in all sessions', () => {
      const sessions = [
        { id: 's1', status: 'completed', agents: [{ messageCount: 5 }, { messageCount: 3 }] },
        { id: 's2', status: 'completed', agents: [{ messageCount: 10 }] },
      ];
      bus = makeBus({ listSessions: vi.fn().mockReturnValue(sessions) });
      const req = makeReq('GET', '/api/stats');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      const body = parseResBody(res) as Record<string, number>;
      expect(body.totalMessages).toBe(18);
    });

    it('returns zeros for empty session list', () => {
      const req = makeReq('GET', '/api/stats');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      const body = parseResBody(res) as Record<string, number>;
      expect(body.totalSessions).toBe(0);
      expect(body.active).toBe(0);
      expect(body.totalMessages).toBe(0);
    });

    it('returns 500 when bus.listSessions() throws', () => {
      bus = makeBus({ listSessions: vi.fn().mockImplementation(() => { throw new Error('fail'); }) });
      const req = makeReq('GET', '/api/stats');
      const res = makeRes();
      handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);

      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    });
  });

  // ---- URL parsing edge cases -------------------------------------------

  describe('URL parsing edge cases', () => {
    it('handles missing host header', () => {
      const req = makeReq('GET', '/api/sessions');
      req.headers = {};
      const res = makeRes();
      // Should not throw
      expect(() => handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse)).not.toThrow();
    });

    it('session path regex only matches single path segment', () => {
      const req = makeReq('GET', '/api/sessions/a/b');
      const res = makeRes();
      // Should not match the session detail route
      const result = handleApiRoute(req as IncomingMessage, res as unknown as ServerResponse, bus, sse);
      expect(result).toBe(false);
    });
  });
});

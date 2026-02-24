/**
 * REST API route handlers for the web dashboard.
 * All data comes from the SQLite transcript bus.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { TranscriptBus } from '../agentic/bus.js';
import type { SSEBroadcaster } from './sse.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse, msg = 'Not found'): void {
  json(res, { error: msg }, 404);
}

function error(res: ServerResponse, msg: string, status = 500): void {
  json(res, { error: msg }, status);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  bus: TranscriptBus,
  sse: SSEBroadcaster,
): boolean {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  // GET /api/sessions — list all sessions
  if (path === '/api/sessions' && method === 'GET') {
    try {
      const sessions = bus.listSessions();
      json(res, sessions);
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // GET /api/sessions/:id — session detail with transcript
  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch && method === 'GET') {
    try {
      const id = sessionMatch[1];
      const session = bus.getSession(id);
      if (!session) {
        notFound(res, `Session ${id} not found`);
        return true;
      }
      const transcript = bus.getTranscript(id);
      json(res, { ...session, transcript });
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // DELETE /api/sessions/:id — delete a session
  if (sessionMatch && method === 'DELETE') {
    try {
      const id = sessionMatch[1];
      bus.deleteSession(id);
      json(res, { deleted: id });
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // GET /api/events?session=:id — SSE stream
  if (path === '/api/events' && method === 'GET') {
    const sessionId = url.searchParams.get('session');
    const cleanup = sse.addClient(res, sessionId);
    req.on('close', cleanup);
    return true;
  }

  // GET /api/stats — dashboard overview
  if (path === '/api/stats' && method === 'GET') {
    try {
      const sessions = bus.listSessions();
      const active = sessions.filter((s) => s.status === 'active').length;
      const completed = sessions.filter((s) => s.status === 'completed').length;
      const failed = sessions.filter((s) => s.status === 'failed').length;
      const totalMessages = sessions.reduce(
        (sum, s) => sum + s.agents.reduce((a, ag) => a + ag.messageCount, 0),
        0,
      );
      json(res, {
        totalSessions: sessions.length,
        active,
        completed,
        failed,
        totalMessages,
        sseClients: sse.clientCount,
      });
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  return false; // Not an API route
}

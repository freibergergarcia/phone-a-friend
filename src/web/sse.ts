/**
 * SSE connection manager — broadcasts AgenticEvents to connected browsers.
 *
 * The orchestrator pushes events here; each connected client gets them
 * as Server-Sent Events. Clients subscribe to a specific session or all.
 */

import type { ServerResponse } from 'node:http';
import type { AgenticEvent } from '../agentic/events.js';

interface SSEClient {
  res: ServerResponse;
  sessionId: string | null; // null = all sessions
}

export class SSEBroadcaster {
  private clients: Set<SSEClient> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Keep connections alive with periodic heartbeats
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.res.write(': heartbeat\n\n');
        } catch {
          this.clients.delete(client);
        }
      }
    }, 15_000);
  }

  /**
   * Add a new SSE client. Sets up headers and returns cleanup function.
   */
  addClient(res: ServerResponse, sessionId: string | null): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');

    const client: SSEClient = { res, sessionId };
    this.clients.add(client);

    return () => {
      this.clients.delete(client);
    };
  }

  /**
   * Broadcast an event to all matching clients.
   */
  broadcast(event: AgenticEvent): void {
    const data = JSON.stringify(event);
    const sessionId = 'sessionId' in event ? (event as { sessionId: string }).sessionId : null;

    for (const client of this.clients) {
      // Send to clients watching this session or all sessions
      if (client.sessionId === null || client.sessionId === sessionId) {
        try {
          client.res.write(`event: ${event.type}\ndata: ${data}\n\n`);
        } catch {
          this.clients.delete(client);
        }
      }
    }
  }

  /**
   * Number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Shut down — close all connections and stop heartbeat.
   */
  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients) {
      try { client.res.end(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}

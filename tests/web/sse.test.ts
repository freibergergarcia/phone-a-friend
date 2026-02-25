/**
 * Tests for SSE broadcaster.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import { SSEBroadcaster } from '../../src/web/sse.js';
import type { AgenticEvent } from '../../src/agentic/events.js';

function mockResponse(): ServerResponse & { chunks: string[] } {
  const res = new EventEmitter() as ServerResponse & { chunks: string[] };
  res.chunks = [];
  res.writeHead = vi.fn().mockReturnValue(res);
  res.write = vi.fn((data: string) => {
    res.chunks.push(data);
    return true;
  });
  res.end = vi.fn();
  return res;
}

describe('SSEBroadcaster', () => {
  let sse: SSEBroadcaster;

  beforeEach(() => {
    sse = new SSEBroadcaster();
  });

  afterEach(() => {
    sse.close();
  });

  it('sends connected comment on client add', () => {
    const res = mockResponse();
    sse.addClient(res, null);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }));
    expect(res.chunks).toContain(': connected\n\n');
  });

  it('tracks client count', () => {
    expect(sse.clientCount).toBe(0);

    const res1 = mockResponse();
    const res2 = mockResponse();
    sse.addClient(res1, null);
    sse.addClient(res2, 'sess-1');

    expect(sse.clientCount).toBe(2);
  });

  it('removes client on cleanup', () => {
    const res = mockResponse();
    const cleanup = sse.addClient(res, null);
    expect(sse.clientCount).toBe(1);

    cleanup();
    expect(sse.clientCount).toBe(0);
  });

  it('broadcasts to all clients when sessionId is null', () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    sse.addClient(res1, null);
    sse.addClient(res2, null);

    const event: AgenticEvent = {
      type: 'session_start',
      sessionId: 'test-123',
      prompt: 'hello',
      agents: [],
      timestamp: new Date(),
    };

    sse.broadcast(event);

    // Both should receive the event
    expect(res1.chunks.some((c) => c.includes('event: session_start'))).toBe(true);
    expect(res2.chunks.some((c) => c.includes('event: session_start'))).toBe(true);
  });

  it('filters by sessionId for targeted clients', () => {
    const res1 = mockResponse(); // watching sess-1
    const res2 = mockResponse(); // watching sess-2
    const res3 = mockResponse(); // watching all
    sse.addClient(res1, 'sess-1');
    sse.addClient(res2, 'sess-2');
    sse.addClient(res3, null);

    const event: AgenticEvent = {
      type: 'message',
      sessionId: 'sess-1',
      from: 'reviewer',
      to: 'critic',
      content: 'hello',
      turn: 0,
      timestamp: new Date(),
    };

    sse.broadcast(event);

    // res1 (watching sess-1) should receive it
    expect(res1.chunks.some((c) => c.includes('event: message'))).toBe(true);
    // res2 (watching sess-2) should NOT
    expect(res2.chunks.some((c) => c.includes('event: message'))).toBe(false);
    // res3 (watching all) should receive it
    expect(res3.chunks.some((c) => c.includes('event: message'))).toBe(true);
  });

  it('removes dead clients on write error', () => {
    const res = mockResponse();
    sse.addClient(res, null);
    expect(sse.clientCount).toBe(1);

    // Simulate write failure
    (res.write as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('broken pipe'); });

    const event: AgenticEvent = {
      type: 'session_start',
      sessionId: 'x',
      prompt: 'test',
      agents: [],
      timestamp: new Date(),
    };

    sse.broadcast(event);
    expect(sse.clientCount).toBe(0);
  });

  it('close() ends all connections', () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    sse.addClient(res1, null);
    sse.addClient(res2, null);

    sse.close();

    expect(res1.end).toHaveBeenCalled();
    expect(res2.end).toHaveBeenCalled();
    expect(sse.clientCount).toBe(0);
  });
});

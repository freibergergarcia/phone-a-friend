/**
 * Tests for DashboardEventSink — batched event delivery to dashboard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import { DashboardEventSink } from '../../src/web/event-sink.js';
import type { AgenticEvent } from '../../src/agentic/events.js';

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function makeEvent(type: string, sessionId = 'test-1'): AgenticEvent {
  return {
    type: 'message',
    sessionId,
    from: 'reviewer',
    to: 'critic',
    content: `event-${type}`,
    turn: 0,
    timestamp: new Date(),
  } as AgenticEvent;
}

describe('DashboardEventSink', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1 }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('batches events and flushes after interval', async () => {
    const sink = new DashboardEventSink('http://localhost:9999/api/ingest');

    sink.push(makeEvent('a'));
    sink.push(makeEvent('b'));

    // Events should not be sent immediately
    expect(fetchSpy).not.toHaveBeenCalled();

    // Wait for flush interval
    await tick();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body).toHaveLength(2);

    await sink.close();
  });

  it('sends to correct URL', async () => {
    const sink = new DashboardEventSink('http://localhost:1234/api/ingest');
    sink.push(makeEvent('a'));
    await tick();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:1234/api/ingest',
      expect.objectContaining({ method: 'POST' }),
    );

    await sink.close();
  });

  it('silently handles fetch failures', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const sink = new DashboardEventSink();
    sink.push(makeEvent('a'));
    await tick();

    // Should not throw
    expect(fetchSpy).toHaveBeenCalled();
    await sink.close();
  });

  it('drops events when queue is full', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const sink = new DashboardEventSink();

    // Push more than MAX_QUEUE_SIZE (200) synchronously before flush fires
    for (let i = 0; i < 210; i++) {
      sink.push(makeEvent(`${i}`));
    }

    // Wait for flush + close
    await tick();
    await sink.close();

    // Should have logged dropped count
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('dropped 10 events'),
    );

    stderrSpy.mockRestore();
  });

  it('does final flush on close', async () => {
    const sink = new DashboardEventSink();
    sink.push(makeEvent('final'));

    await sink.close();

    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body).toHaveLength(1);
    expect(body[0].content).toBe('event-final');
  });

  it('skips flush when queue is empty', async () => {
    const sink = new DashboardEventSink();
    await tick();

    // No events pushed — should not fetch
    expect(fetchSpy).not.toHaveBeenCalled();

    await sink.close();
  });
});

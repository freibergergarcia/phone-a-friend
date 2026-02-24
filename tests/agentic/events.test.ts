/**
 * Tests for agentic event channel.
 */

import { describe, it, expect } from 'vitest';
import { EventChannel } from '../../src/agentic/events.js';
import type { AgenticEvent } from '../../src/agentic/events.js';

describe('EventChannel', () => {
  it('delivers pushed events to async iterator', async () => {
    const channel = new EventChannel();
    const events: AgenticEvent[] = [];

    const event: AgenticEvent = {
      type: 'session_start',
      sessionId: 'test',
      prompt: 'hello',
      agents: [],
      timestamp: new Date(),
    };

    channel.push(event);
    channel.close();

    for await (const e of channel) {
      events.push(e);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session_start');
  });

  it('queues events before consumer reads', async () => {
    const channel = new EventChannel();

    channel.push({
      type: 'message',
      sessionId: 'test',
      from: 'a',
      to: 'b',
      content: 'first',
      turn: 1,
      timestamp: new Date(),
    });
    channel.push({
      type: 'message',
      sessionId: 'test',
      from: 'b',
      to: 'a',
      content: 'second',
      turn: 2,
      timestamp: new Date(),
    });
    channel.close();

    const events: AgenticEvent[] = [];
    for await (const e of channel) {
      events.push(e);
    }

    expect(events).toHaveLength(2);
  });

  it('resolves waiting consumer when event is pushed', async () => {
    const channel = new EventChannel();

    // Start consuming before pushing
    const iterator = channel[Symbol.asyncIterator]();
    const promise = iterator.next();

    // Push after a tick
    setTimeout(() => {
      channel.push({
        type: 'turn_complete',
        sessionId: 'test',
        turn: 1,
        pendingCount: 0,
        timestamp: new Date(),
      });
    }, 10);

    const result = await promise;
    expect(result.done).toBe(false);
    expect(result.value.type).toBe('turn_complete');

    channel.close();
  });

  it('signals done when closed', async () => {
    const channel = new EventChannel();
    const iterator = channel[Symbol.asyncIterator]();

    setTimeout(() => channel.close(), 10);

    const result = await iterator.next();
    expect(result.done).toBe(true);
  });

  it('ignores pushes after close', async () => {
    const channel = new EventChannel();

    channel.push({
      type: 'session_start',
      sessionId: 'test',
      prompt: 'hello',
      agents: [],
      timestamp: new Date(),
    });
    channel.close();

    // This should be silently ignored
    channel.push({
      type: 'session_end',
      sessionId: 'test',
      reason: 'converged',
      turn: 1,
      elapsed: 100,
      timestamp: new Date(),
    });

    const events: AgenticEvent[] = [];
    for await (const e of channel) {
      events.push(e);
    }

    expect(events).toHaveLength(1);
  });
});

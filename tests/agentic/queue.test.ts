/**
 * Tests for agentic in-memory message queue.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageQueue } from '../../src/agentic/queue.js';
import type { Message } from '../../src/agentic/types.js';

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    sessionId: 'test-session',
    from: 'security',
    to: 'perf',
    content: 'test message',
    timestamp: new Date(),
    turn: 1,
    ...overrides,
  };
}

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  it('starts empty', () => {
    expect(queue.isEmpty()).toBe(true);
    expect(queue.size()).toBe(0);
  });

  it('enqueues and dequeues messages', () => {
    const msg = makeMsg();
    queue.enqueue(msg);

    expect(queue.isEmpty()).toBe(false);
    expect(queue.size()).toBe(1);

    const dequeued = queue.dequeue('perf');
    expect(dequeued).toHaveLength(1);
    expect(dequeued[0].content).toBe('test message');

    expect(queue.isEmpty()).toBe(true);
  });

  it('returns empty array when no messages for agent', () => {
    queue.enqueue(makeMsg({ to: 'perf' }));
    const dequeued = queue.dequeue('quality');
    expect(dequeued).toHaveLength(0);
  });

  it('groups messages by target agent', () => {
    queue.enqueue(makeMsg({ to: 'perf', content: 'msg1' }));
    queue.enqueue(makeMsg({ to: 'perf', content: 'msg2' }));
    queue.enqueue(makeMsg({ to: 'quality', content: 'msg3' }));

    expect(queue.size()).toBe(3);

    const perfMsgs = queue.dequeue('perf');
    expect(perfMsgs).toHaveLength(2);

    const qualMsgs = queue.dequeue('quality');
    expect(qualMsgs).toHaveLength(1);

    expect(queue.isEmpty()).toBe(true);
  });

  it('dequeueAll returns all grouped messages and clears', () => {
    queue.enqueue(makeMsg({ to: 'perf' }));
    queue.enqueue(makeMsg({ to: 'quality' }));

    const all = queue.dequeueAll();
    expect(all.size).toBe(2);
    expect(all.get('perf')).toHaveLength(1);
    expect(all.get('quality')).toHaveLength(1);
    expect(queue.isEmpty()).toBe(true);
  });

  it('counts returns per-agent pending counts', () => {
    queue.enqueue(makeMsg({ to: 'perf' }));
    queue.enqueue(makeMsg({ to: 'perf' }));
    queue.enqueue(makeMsg({ to: 'quality' }));

    const counts = queue.counts();
    expect(counts).toEqual({ perf: 2, quality: 1 });
  });

  it('clear removes all messages', () => {
    queue.enqueue(makeMsg({ to: 'perf' }));
    queue.enqueue(makeMsg({ to: 'quality' }));

    queue.clear();
    expect(queue.isEmpty()).toBe(true);
    expect(queue.size()).toBe(0);
  });

  it('preserves message order', () => {
    queue.enqueue(makeMsg({ to: 'perf', content: 'first' }));
    queue.enqueue(makeMsg({ to: 'perf', content: 'second' }));
    queue.enqueue(makeMsg({ to: 'perf', content: 'third' }));

    const msgs = queue.dequeue('perf');
    expect(msgs.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });
});

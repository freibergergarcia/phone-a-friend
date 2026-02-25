/**
 * In-memory message queue for runtime routing within an agentic session.
 *
 * Single-process, single-consumer — no concurrency concerns.
 * Messages flow: orchestrator enqueues → orchestrator dequeues per agent.
 */

import type { Message } from './types.js';

export class MessageQueue {
  private pending: Map<string, Message[]> = new Map();

  /** Enqueue a message for delivery to a target agent. */
  enqueue(msg: Message): void {
    const target = msg.to;
    const existing = this.pending.get(target);
    if (existing) {
      existing.push(msg);
    } else {
      this.pending.set(target, [msg]);
    }
  }

  /** Dequeue all pending messages for an agent. Returns empty array if none. */
  dequeue(agent: string): Message[] {
    const msgs = this.pending.get(agent);
    if (!msgs || msgs.length === 0) return [];
    this.pending.delete(agent);
    return msgs;
  }

  /** Dequeue all pending messages grouped by target agent. */
  dequeueAll(): Map<string, Message[]> {
    const result = new Map(this.pending);
    this.pending.clear();
    return result;
  }

  /** Check if there are any pending messages for any agent. */
  isEmpty(): boolean {
    for (const msgs of this.pending.values()) {
      if (msgs.length > 0) return false;
    }
    return true;
  }

  /** Total number of pending messages across all agents. */
  size(): number {
    let count = 0;
    for (const msgs of this.pending.values()) {
      count += msgs.length;
    }
    return count;
  }

  /** Get pending message count per agent (for diagnostics). */
  counts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [agent, msgs] of this.pending) {
      if (msgs.length > 0) result[agent] = msgs.length;
    }
    return result;
  }

  /** Clear all pending messages. */
  clear(): void {
    this.pending.clear();
  }
}

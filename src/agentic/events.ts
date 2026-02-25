/**
 * Event types for agentic mode.
 *
 * The orchestrator emits AgenticEvents through an AsyncIterable stream.
 * Consumers: CLI (formatted text), TUI (React hook), Web dashboard (SSE).
 */

import type { AgentState } from './types.js';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AgenticEvent =
  | SessionStartEvent
  | MessageEvent
  | AgentStatusEvent
  | TurnCompleteEvent
  | GuardrailEvent
  | SessionEndEvent
  | ErrorEvent;

export interface SessionStartEvent {
  type: 'session_start';
  sessionId: string;
  prompt: string;
  agents: AgentState[];
  timestamp: Date;
}

export interface MessageEvent {
  type: 'message';
  sessionId: string;
  from: string;
  to: string;
  content: string;
  turn: number;
  timestamp: Date;
}

export interface AgentStatusEvent {
  type: 'agent_status';
  sessionId: string;
  agent: string;
  status: 'active' | 'idle' | 'dead';
  timestamp: Date;
}

export interface TurnCompleteEvent {
  type: 'turn_complete';
  sessionId: string;
  turn: number;
  pendingCount: number;
  timestamp: Date;
}

export interface GuardrailEvent {
  type: 'guardrail';
  sessionId: string;
  guard: string;
  detail: string;
  timestamp: Date;
}

export interface SessionEndEvent {
  type: 'session_end';
  sessionId: string;
  reason: 'converged' | 'max_turns' | 'timeout' | 'stopped' | 'error';
  turn: number;
  elapsed: number;
  timestamp: Date;
}

export interface ErrorEvent {
  type: 'error';
  sessionId: string;
  agent?: string;
  error: string;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Event emitter helper
// ---------------------------------------------------------------------------

export type EventCallback = (event: AgenticEvent) => void;

/**
 * Simple event channel that bridges push (orchestrator) and pull (consumers).
 * The orchestrator calls push(). Consumers iterate via [Symbol.asyncIterator].
 */
export class EventChannel {
  private queue: AgenticEvent[] = [];
  private resolve: ((value: IteratorResult<AgenticEvent>) => void) | null = null;
  private done = false;
  private consuming = false;

  push(event: AgenticEvent): void {
    if (this.done) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  close(): void {
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as AgenticEvent, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AgenticEvent> {
    if (this.consuming) {
      throw new Error('EventChannel supports only one consumer');
    }
    this.consuming = true;
    return {
      next: () => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as AgenticEvent, done: true });
        }
        return new Promise<IteratorResult<AgenticEvent>>((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}

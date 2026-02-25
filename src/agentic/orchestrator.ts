/**
 * Agentic mode orchestrator.
 *
 * Owns the main loop: spawn agents, route messages, enforce guardrails,
 * emit events. Single-process, single-consumer.
 */

import { randomUUID } from 'node:crypto';
import { MessageQueue } from './queue.js';
import { TranscriptBus } from './bus.js';
import { SessionManager } from './session.js';
import { parseAgentResponse, buildSystemPrompt } from './parser.js';
import { EventChannel } from './events.js';
import type { AgenticEvent } from './events.js';
import {
  AGENTIC_DEFAULTS,
  type AgenticSessionConfig,
  type AgentState,
  type Message,
} from './types.js';
import { assignAgentNames } from './names.js';

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private queue = new MessageQueue();
  private sessions = new SessionManager();
  private bus: TranscriptBus;
  private events = new EventChannel();
  private agentStates = new Map<string, AgentState>();
  private sessionId = '';
  private turn = 0;
  private startTime = 0;

  // External listeners (SSE, dashboard, etc.)
  private listeners: Array<(event: AgenticEvent) => void> = [];

  // Guardrail state
  private consecutiveExchanges = new Map<string, number>();
  private lastPingPongTurn = -1;
  private noProgressCount = 0;

  // Lifecycle
  private stopped = false;
  private sessionEnded = false;
  private runLoopPromise: Promise<void> | null = null;

  constructor(dbPath?: string) {
    this.bus = new TranscriptBus(dbPath);
  }

  /**
   * Run an agentic session. Returns an AsyncIterable of events that
   * consumers (CLI, TUI, web dashboard) can subscribe to.
   */
  async run(config: AgenticSessionConfig): Promise<AsyncIterable<AgenticEvent>> {
    if (this.runLoopPromise) {
      throw new Error('Orchestrator is already running. Create a new instance for concurrent sessions.');
    }

    // Reset all session-scoped state for safe reuse
    this.sessionId = randomUUID().slice(0, 7);
    this.turn = 0;
    this.startTime = Date.now();
    this.stopped = false;
    this.sessionEnded = false;
    this.events = new EventChannel();
    this.agentStates = new Map();
    this.consecutiveExchanges = new Map();
    this.lastPingPongTurn = -1;
    this.noProgressCount = 0;
    this.queue.clear();
    this.sessions.clear();

    // Create session in transcript
    this.bus.createSession(this.sessionId, config.prompt, config.maxTurns);

    // Assign creative first names to agents (e.g. storyteller → maren.storyteller)
    const namedAgents = assignAgentNames(config.agents);
    config = { ...config, agents: namedAgents };

    // Register agents
    const agentNames = config.agents.map((a) => a.name);
    const knownTargets = new Set([...agentNames, 'all', 'user']);

    for (const agent of config.agents) {
      this.bus.addAgent(this.sessionId, agent.name, agent.backend, agent.model);
      this.agentStates.set(agent.name, {
        name: agent.name,
        backend: agent.backend,
        model: agent.model,
        status: 'active',
        messageCount: 0,
      });
    }

    // Emit session start
    const agentStatesArr = [...this.agentStates.values()];
    this.emit({
      type: 'session_start',
      sessionId: this.sessionId,
      prompt: config.prompt,
      agents: agentStatesArr,
      timestamp: new Date(),
    });

    // Spawn agents and seed initial prompt
    this.runLoopPromise = this.runLoop(config, knownTargets)
      .catch((err) => {
        this.emit({
          type: 'error',
          sessionId: this.sessionId,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date(),
        });
        this.endSession('error');
      })
      .finally(() => {
        this.runLoopPromise = null;
      });

    return this.events;
  }

  /**
   * Stop the current session.
   */
  stop(): void {
    this.stopped = true;
    this.endSession('stopped');
  }

  /**
   * Stop the loop (if running) and close the transcript database.
   */
  async close(): Promise<void> {
    this.stopped = true;
    this.endSession('stopped');
    if (this.runLoopPromise) {
      await this.runLoopPromise;
    }
    this.bus.close();
  }

  // ---- Main loop ----------------------------------------------------------

  private async runLoop(
    config: AgenticSessionConfig,
    knownTargets: Set<string>,
  ): Promise<void> {
    const { agents, prompt, maxTurns, timeoutSeconds, repoPath } = config;

    // Phase 1a: Spawn all agents — deliver initial prompt to each, collect responses
    const spawnResults: Array<{ agent: typeof agents[number]; output: string }> = [];

    for (const agent of agents) {
      if (this.stopped) return;
      const systemPrompt = buildSystemPrompt(
        agent.name,
        agents.map((a) => a.name),
        agent.description,
        maxTurns,
      );

      try {
        this.emitAgentStatus(agent.name, 'active');

        const result = await this.sessions.spawn(
          agent, systemPrompt, prompt, repoPath,
        );

        if (this.stopped) return;

        this.bus.updateAgent(this.sessionId, agent.name, {
          backendSessionId: result.sessionId,
        });

        // Log user→agent delivery immediately
        this.logAndEmitMessage('user', agent.name, prompt, 0);
        spawnResults.push({ agent, output: result.output });

        this.emitAgentStatus(agent.name, 'idle');
      } catch (err) {
        this.emit({
          type: 'error',
          sessionId: this.sessionId,
          agent: agent.name,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date(),
        });
        this.emitAgentStatus(agent.name, 'dead');
      }
    }

    // Phase 1b: Process responses — parse and route after all agents received the prompt
    for (const { agent, output } of spawnResults) {
      const parsed = parseAgentResponse(output, knownTargets);

      for (const msg of parsed.messages) {
        this.logAndEmitMessage(agent.name, msg.to, msg.content, 0);

        if (msg.to === 'all') {
          for (const other of agents) {
            if (other.name !== agent.name) {
              this.queue.enqueue({
                sessionId: this.sessionId,
                from: agent.name,
                to: other.name,
                content: msg.content,
                timestamp: new Date(),
                turn: 0,
              });
            }
          }
        } else if (msg.to !== 'user') {
          this.queue.enqueue({
            sessionId: this.sessionId,
            from: agent.name,
            to: msg.to,
            content: msg.content,
            timestamp: new Date(),
            turn: 0,
          });
        }
      }

      if (parsed.notes) {
        this.logAndEmitMessage(agent.name, 'notes', parsed.notes, 0);
      }
    }

    this.emit({
      type: 'turn_complete',
      sessionId: this.sessionId,
      turn: 0,
      pendingCount: this.queue.size(),
      timestamp: new Date(),
    });

    // Phase 2: Message routing loop
    this.turn = 1;

    while (this.turn <= maxTurns && !this.stopped) {
      // Timeout check
      if (this.isTimedOut(timeoutSeconds)) {
        this.emit({
          type: 'guardrail',
          sessionId: this.sessionId,
          guard: 'timeout',
          detail: `Session timed out after ${timeoutSeconds}s`,
          timestamp: new Date(),
        });
        this.endSession('timeout');
        return;
      }

      // No messages pending — converged
      if (this.queue.isEmpty()) {
        this.noProgressCount++;
        if (this.noProgressCount >= AGENTIC_DEFAULTS.noProgressThreshold) {
          this.emit({
            type: 'guardrail',
            sessionId: this.sessionId,
            guard: 'converged',
            detail: `No new messages for ${this.noProgressCount} consecutive turns`,
            timestamp: new Date(),
          });
          this.endSession('converged');
          return;
        }
      } else {
        this.noProgressCount = 0;
      }

      // Dequeue and route
      const pending = this.queue.dequeueAll();
      if (pending.size === 0) {
        this.endSession('converged');
        return;
      }

      for (const [agentName, messages] of pending) {
        if (this.stopped) break;

        const agent = agents.find((a) => a.name === agentName);
        if (!agent) continue;

        const state = this.agentStates.get(agentName);
        if (!state || state.status === 'dead') continue;

        // Ping-pong detection
        if (this.detectPingPong(messages)) {
          this.emit({
            type: 'guardrail',
            sessionId: this.sessionId,
            guard: 'ping_pong',
            detail: `Breaking conversation cycle involving ${agentName}`,
            timestamp: new Date(),
          });
          continue;
        }

        // Build prompt from incoming messages
        const parts = messages.map((m) => `@${m.from} says: ${m.content}`);

        // Inject deadline warning on the last turn
        if (this.turn >= maxTurns) {
          parts.unshift(
            '⚠️ FINAL TURN — the session ends after this response. Deliver your final output to @user NOW. Do not @mention other agents.',
          );
        } else if (this.turn >= maxTurns - 1) {
          parts.unshift(
            `⚠️ WARNING: Only ${maxTurns - this.turn} turn(s) remaining. Wrap up and prepare to deliver final output to @user.`,
          );
        }

        const incomingPrompt = parts.join('\n\n');

        try {
          this.emitAgentStatus(agentName, 'active');

          const output = await this.sessions.resume(
            agentName, incomingPrompt, repoPath,
          );

          // Bail if stopped during await
          if (this.stopped) break;

          const parsed = parseAgentResponse(output, knownTargets);

          // Route outbound
          for (const msg of parsed.messages) {
            this.logAndEmitMessage(agentName, msg.to, msg.content, this.turn);

            if (msg.to === 'all') {
              for (const other of agents) {
                if (other.name !== agentName) {
                  this.queue.enqueue({
                    sessionId: this.sessionId,
                    from: agentName,
                    to: other.name,
                    content: msg.content,
                    timestamp: new Date(),
                    turn: this.turn,
                  });
                }
              }
            } else if (msg.to !== 'user') {
              this.queue.enqueue({
                sessionId: this.sessionId,
                from: agentName,
                to: msg.to,
                content: msg.content,
                timestamp: new Date(),
                turn: this.turn,
              });
            }
          }

          if (parsed.notes) {
            this.logAndEmitMessage(agentName, 'notes', parsed.notes, this.turn);
          }

          this.emitAgentStatus(agentName, 'idle');
        } catch (err) {
          this.emit({
            type: 'error',
            sessionId: this.sessionId,
            agent: agentName,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date(),
          });
          this.emitAgentStatus(agentName, 'dead');
        }
      }

      this.emit({
        type: 'turn_complete',
        sessionId: this.sessionId,
        turn: this.turn,
        pendingCount: this.queue.size(),
        timestamp: new Date(),
      });

      this.turn++;
    }

    // Loop exited — determine reason
    if (this.stopped) {
      // stop() or close() already called endSession
      return;
    }

    // Max turns reached
    this.emit({
      type: 'guardrail',
      sessionId: this.sessionId,
      guard: 'max_turns',
      detail: `Reached maximum of ${maxTurns} turns`,
      timestamp: new Date(),
    });
    this.endSession('max_turns');
  }

  // ---- Helpers ------------------------------------------------------------

  /**
   * Subscribe to events (for SSE broadcast, logging, etc.).
   * Returns unsubscribe function.
   */
  onEvent(listener: (event: AgenticEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: AgenticEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* don't let listeners break the loop */ }
    }
  }

  private emitAgentStatus(agent: string, status: AgentState['status']): void {
    const state = this.agentStates.get(agent);
    if (state) {
      state.status = status;
      this.bus.updateAgent(this.sessionId, agent, { status });
    }
    this.emit({
      type: 'agent_status',
      sessionId: this.sessionId,
      agent,
      status,
      timestamp: new Date(),
    });
  }

  private logAndEmitMessage(
    from: string,
    to: string,
    content: string,
    turn: number,
  ): void {
    this.bus.appendMessage({
      sessionId: this.sessionId,
      from,
      to,
      content,
      turn,
    });

    this.emit({
      type: 'message',
      sessionId: this.sessionId,
      from,
      to,
      content,
      turn,
      timestamp: new Date(),
    });
  }

  private endSession(reason: 'converged' | 'max_turns' | 'timeout' | 'stopped' | 'error'): void {
    if (this.sessionEnded) return;
    this.sessionEnded = true;

    const elapsed = Date.now() - this.startTime;

    const busStatus = reason === 'error' ? 'failed'
      : reason === 'stopped' ? 'stopped'
      : 'completed';
    this.bus.endSession(this.sessionId, busStatus);

    this.emit({
      type: 'session_end',
      sessionId: this.sessionId,
      reason,
      turn: this.turn,
      elapsed,
      timestamp: new Date(),
    });

    this.events.close();
    this.sessions.clear();
    this.queue.clear();
  }

  private isTimedOut(timeoutSeconds: number): boolean {
    return (Date.now() - this.startTime) > timeoutSeconds * 1000;
  }

  private detectPingPong(messages: Message[]): boolean {
    // Reset streak counters on turn boundary (new turn = fresh window)
    if (this.turn !== this.lastPingPongTurn) {
      this.lastPingPongTurn = this.turn;
      // Don't clear — decay: halve counts each turn so long convos don't false-trigger
      for (const [pair, count] of this.consecutiveExchanges) {
        if (count <= 1) {
          this.consecutiveExchanges.delete(pair);
        } else {
          this.consecutiveExchanges.set(pair, Math.floor(count / 2));
        }
      }
    }

    for (const msg of messages) {
      const pair = [msg.from, msg.to].sort().join(':');
      const count = (this.consecutiveExchanges.get(pair) ?? 0) + 1;
      this.consecutiveExchanges.set(pair, count);

      // Threshold from config (default 6 = 3 round trips) within decay window
      if (count >= AGENTIC_DEFAULTS.pingPongThreshold) {
        return true;
      }
    }
    return false;
  }
}

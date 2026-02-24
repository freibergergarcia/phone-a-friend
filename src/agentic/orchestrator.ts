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
import type {
  AgenticSessionConfig,
  AgentState,
  AGENTIC_DEFAULTS,
  Message,
} from './types.js';

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

  // Guardrail state
  private consecutiveExchanges = new Map<string, number>();
  private noProgressCount = 0;

  constructor(dbPath?: string) {
    this.bus = new TranscriptBus(dbPath);
  }

  /**
   * Run an agentic session. Returns an AsyncIterable of events that
   * consumers (CLI, TUI, web dashboard) can subscribe to.
   */
  async run(config: AgenticSessionConfig): Promise<AsyncIterable<AgenticEvent>> {
    this.sessionId = randomUUID().slice(0, 7);
    this.turn = 0;
    this.startTime = Date.now();

    // Create session in transcript
    this.bus.createSession(this.sessionId, config.prompt);

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
    this.runLoop(config, knownTargets).catch((err) => {
      this.emit({
        type: 'error',
        sessionId: this.sessionId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date(),
      });
      this.endSession('error');
    });

    return this.events;
  }

  /**
   * Stop the current session.
   */
  stop(): void {
    this.endSession('stopped');
  }

  /**
   * Close the transcript database.
   */
  close(): void {
    this.bus.close();
  }

  // ---- Main loop ----------------------------------------------------------

  private async runLoop(
    config: AgenticSessionConfig,
    knownTargets: Set<string>,
  ): Promise<void> {
    const { agents, prompt, maxTurns, timeoutSeconds, repoPath } = config;

    // Phase 1: Spawn all agents with initial prompt
    for (const agent of agents) {
      const systemPrompt = buildSystemPrompt(
        agent.name,
        agents.map((a) => a.name),
        agent.description,
      );

      try {
        this.emitAgentStatus(agent.name, 'active');

        const result = await this.sessions.spawn(
          agent, systemPrompt, prompt, repoPath,
        );

        // Update backend session ID
        this.bus.updateAgent(this.sessionId, agent.name, {
          backendSessionId: result.sessionId,
        });

        // Log the initial user→agent message
        this.logAndEmitMessage('user', agent.name, prompt, 0);

        // Parse agent's initial response
        const parsed = parseAgentResponse(result.output, knownTargets);

        // Route outbound messages
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

        // Log notes if any
        if (parsed.notes) {
          this.logAndEmitMessage(agent.name, 'notes', parsed.notes, 0);
        }

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

    this.emit({
      type: 'turn_complete',
      sessionId: this.sessionId,
      turn: 0,
      pendingCount: this.queue.size(),
      timestamp: new Date(),
    });

    // Phase 2: Message routing loop
    this.turn = 1;

    while (this.turn <= maxTurns) {
      // Timeout check
      if (this.isTimedOut(timeoutSeconds)) {
        this.emit({
          type: 'guardrail',
          sessionId: this.sessionId,
          guard: 'timeout',
          detail: `Session timed out after ${timeoutSeconds}s`,
          timestamp: new Date(),
        });
        this.endSession('completed');
        return;
      }

      // No messages pending — converged
      if (this.queue.isEmpty()) {
        this.noProgressCount++;
        if (this.noProgressCount >= 2) {
          this.emit({
            type: 'guardrail',
            sessionId: this.sessionId,
            guard: 'converged',
            detail: `No new messages for ${this.noProgressCount} consecutive turns`,
            timestamp: new Date(),
          });
          this.endSession('completed');
          return;
        }
      } else {
        this.noProgressCount = 0;
      }

      // Dequeue and route
      const pending = this.queue.dequeueAll();
      if (pending.size === 0) {
        this.endSession('completed');
        return;
      }

      for (const [agentName, messages] of pending) {
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
        const incomingPrompt = messages
          .map((m) => `@${m.from} says: ${m.content}`)
          .join('\n\n');

        try {
          this.emitAgentStatus(agentName, 'active');

          const output = await this.sessions.resume(
            agentName, incomingPrompt, repoPath,
          );

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

    // Max turns reached
    this.emit({
      type: 'guardrail',
      sessionId: this.sessionId,
      guard: 'max_turns',
      detail: `Reached maximum of ${maxTurns} turns`,
      timestamp: new Date(),
    });
    this.endSession('completed');
  }

  // ---- Helpers ------------------------------------------------------------

  private emit(event: AgenticEvent): void {
    this.events.push(event);
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

    // Only emit routable messages (not notes)
    if (to !== 'notes') {
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
  }

  private endSession(reason: 'completed' | 'stopped' | 'error'): void {
    const elapsed = Date.now() - this.startTime;
    const sessionEndReason = reason === 'completed'
      ? (this.turn >= 20 ? 'max_turns' : 'converged')
      : reason;

    this.bus.endSession(this.sessionId, reason === 'error' ? 'failed' : reason);

    this.emit({
      type: 'session_end',
      sessionId: this.sessionId,
      reason: sessionEndReason,
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
    // Track consecutive exchanges between the same pair
    for (const msg of messages) {
      const pair = [msg.from, msg.to].sort().join(':');
      const count = (this.consecutiveExchanges.get(pair) ?? 0) + 1;
      this.consecutiveExchanges.set(pair, count);

      if (count > 4) {
        return true;
      }
    }
    return false;
  }
}

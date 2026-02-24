/**
 * Agentic mode — public API.
 *
 * Persistent multi-agent sessions where backend agents communicate
 * with each other through an orchestrated message bus.
 */

export { Orchestrator } from './orchestrator.js';
export { TranscriptBus, defaultDbPath } from './bus.js';
export { MessageQueue } from './queue.js';
export { SessionManager } from './session.js';
export { parseAgentResponse, buildSystemPrompt } from './parser.js';
export { EventChannel } from './events.js';

export type { AgenticEvent } from './events.js';
export type {
  AgentConfig,
  AgenticSessionConfig,
  AgentState,
  AgenticSession,
  Message,
  SessionStatus,
} from './types.js';
export { AGENTIC_DEFAULTS } from './types.js';

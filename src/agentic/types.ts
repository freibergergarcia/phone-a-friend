/**
 * Core types for agentic mode — persistent multi-agent sessions.
 */

// ---------------------------------------------------------------------------
// Agent & Session
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** Role name, e.g. "security", "perf" */
  name: string;
  /** Backend to use: claude, codex, gemini, ollama */
  backend: string;
  /** Optional model override */
  model?: string;
  /** Optional role description for system prompt */
  description?: string;
}

export interface AgenticSessionConfig {
  /** Agent definitions: role:backend pairs */
  agents: AgentConfig[];
  /** Initial prompt / task description */
  prompt: string;
  /** Max turns before forced stop */
  maxTurns: number;
  /** Session timeout in seconds */
  timeoutSeconds: number;
  /** Repository path for backend context */
  repoPath: string;
  /** Sandbox mode for backends */
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export interface AgentState {
  name: string;
  backend: string;
  model?: string;
  backendSessionId?: string;
  status: 'active' | 'idle' | 'dead';
  messageCount: number;
  lastSeen?: Date;
}

export type SessionStatus = 'active' | 'completed' | 'failed' | 'stopped';

export interface AgenticSession {
  id: string;
  createdAt: Date;
  endedAt?: Date;
  prompt: string;
  status: SessionStatus;
  agents: AgentState[];
  turn: number;
  maxTurns: number;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Message {
  id?: number;
  sessionId: string;
  from: string;
  to: string;
  content: string;
  timestamp: Date;
  turn: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const AGENTIC_DEFAULTS = {
  maxTurns: 20,
  timeoutSeconds: 900, // 15 minutes
  maxMessageSize: 50 * 1024, // 50 KB
  pingPongThreshold: 4,
  noProgressThreshold: 2,
  maxAgentTurnsPerRound: 3,
} as const;

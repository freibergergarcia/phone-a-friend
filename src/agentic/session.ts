/**
 * Session manager for agentic mode.
 *
 * Wraps backend CLIs with session persistence. Agentic mode is Claude-only
 * today: dispatch is keyed on backend identity, never on a declared resume
 * strategy. Codex, Gemini, and OpenCode also declare `native-session`, so a
 * strategy-based branch would silently run `claude` for them. That request
 * now fails explicitly (see `assertAgenticBackendSupported`).
 *
 * Known discrepancy, kept on purpose: the transcript-replay route below
 * (`statelessRun` / `statelessResume`) is scaffolding. `execBackend` rejects
 * every backend, so replay-strategy and unsupported-strategy backends fail
 * with the same "not yet supported" error they always have. Real adapters
 * are a separate change.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getBackend } from '../backends/index.js';
import type { AgentConfig } from './types.js';

// Env vars that trigger Claude's nested-session guard
const NESTED_SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION'];

/** The only backend with an agentic adapter. Dispatch is keyed on this name. */
const AGENTIC_NATIVE_BACKEND = 'claude';

/**
 * Raised when an agentic request names a backend PaF cannot drive in agentic
 * mode. Carries the backend so consumers can report it without regexing.
 */
export class AgenticBackendError extends Error {
  readonly backend: string;
  constructor(backend: string, message: string) {
    super(message);
    this.name = 'AgenticBackendError';
    this.backend = backend;
  }
}

/**
 * Guard for both spawn() and resume(). Runs before any subprocess is started
 * or session state is touched.
 *
 * - `claude` passes through to the native Claude session path.
 * - Any other backend that declares `native-session` is rejected explicitly.
 *   PaF neither substitutes Claude nor downgrades the request to replay.
 * - Other strategies fall through to the (currently rejecting) replay route.
 */
export function assertAgenticBackendSupported(backendName: string): void {
  if (backendName === AGENTIC_NATIVE_BACKEND) return;
  const { resumeStrategy } = getBackend(backendName).capabilities;
  if (resumeStrategy === 'native-session') {
    throw new AgenticBackendError(
      backendName,
      `Backend "${backendName}" is not yet supported in agentic mode: it declares native-session resume ` +
        `but PaF has no agentic adapter for it, and PaF will not substitute ${AGENTIC_NATIVE_BACKEND}. ` +
        `Use ${AGENTIC_NATIVE_BACKEND} for agentic runs, or relay to ${backendName} directly with ` +
        `"phone-a-friend --to ${backendName}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionInfo {
  agentName: string;
  backend: string;
  sessionId: string;
  history: string[];
}

interface SpawnResult {
  output: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  /**
   * Spawn a new agent session. Returns the agent's first response.
   */
  async spawn(
    agent: AgentConfig,
    systemPrompt: string,
    initialPrompt: string,
    repoPath: string,
  ): Promise<SpawnResult> {
    // Guard first: no UUID reuse concerns, but no subprocess and no session
    // record may exist for a rejected backend.
    assertAgenticBackendSupported(agent.backend);
    const sessionId = randomUUID();

    if (agent.backend === AGENTIC_NATIVE_BACKEND) {
      const output = await this.spawnClaude(
        sessionId, systemPrompt, initialPrompt, repoPath, agent.model,
      );
      this.sessions.set(agent.name, {
        agentName: agent.name,
        backend: agent.backend,
        sessionId,
        history: [initialPrompt, output],
      });
      return { output, sessionId };
    }

    // Fallback: stateless run with transcript replay
    const output = await this.statelessRun(
      agent.backend, systemPrompt, initialPrompt, repoPath, agent.model,
    );
    this.sessions.set(agent.name, {
      agentName: agent.name,
      backend: agent.backend,
      sessionId,
      history: [initialPrompt, output],
    });
    return { output, sessionId };
  }

  /**
   * Resume an agent session with a new message. Returns the agent's response.
   */
  async resume(agentName: string, message: string, repoPath: string): Promise<string> {
    const session = this.sessions.get(agentName);
    if (!session) throw new Error(`No session for agent: ${agentName}`);

    // Don't mutate history until backend succeeds — avoids phantom messages on failure.
    // Re-check identity here too: a session record must never be resumed through
    // the Claude path just because its backend declares native-session.
    assertAgenticBackendSupported(session.backend);

    if (session.backend === AGENTIC_NATIVE_BACKEND) {
      const output = await this.resumeClaude(session.sessionId, message, repoPath);
      session.history.push(message, output);
      return output;
    }

    const output = await this.statelessResume(session, message, repoPath);
    session.history.push(message, output);
    return output;
  }

  /**
   * Check if an agent has an active session.
   */
  hasSession(agentName: string): boolean {
    return this.sessions.has(agentName);
  }

  /**
   * Get session info for an agent.
   */
  getSession(agentName: string): SessionInfo | undefined {
    return this.sessions.get(agentName);
  }

  /**
   * Kill all sessions.
   */
  clear(): void {
    this.sessions.clear();
  }

  // ---- Claude (persistent sessions) --------------------------------------

  private spawnClaude(
    sessionId: string,
    systemPrompt: string,
    prompt: string,
    repoPath: string,
    model?: string,
  ): Promise<string> {
    const args = [
      '-p', `${systemPrompt}\n\n---\n\n${prompt}`,
      '--session-id', sessionId,
      '--add-dir', repoPath,
      '--max-turns', '3',
      '--output-format', 'text',
    ];

    if (model) {
      args.push('--model', model);
    }

    // Read-only tools for review sessions
    args.push('--tools', 'Read,Grep,Glob,LS,WebFetch,WebSearch');
    args.push('--allowedTools', 'Read,Grep,Glob,LS,WebFetch,WebSearch');

    // Prevent recursion
    args.push('--disable-slash-commands');
    args.push('--disallowedTools', 'Task');

    return this.execClaude(args, repoPath);
  }

  private resumeClaude(
    sessionId: string,
    message: string,
    repoPath: string,
  ): Promise<string> {
    const args = [
      '-p', message,
      '-r', sessionId,
      '--max-turns', '3',
      '--output-format', 'text',
    ];

    return this.execClaude(args, repoPath);
  }

  private execClaude(args: string[], repoPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = this.cleanEnv();
      const child = spawn('claude', args, {
        env,
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let settled = false;
      const settle = (fn: typeof resolve | typeof reject, value: string | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        (fn as (v: string | Error) => void)(value);
      };

      // Fail fast if binary not found or spawn fails
      child.on('error', (err: Error) => {
        settle(reject, new Error(`Failed to spawn claude: ${err.message}`));
      });

      // Close stdin immediately — Claude waits for EOF before processing
      child.stdin?.end();

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timeoutMs = 600_000; // 10 minutes — Claude Code with tools needs time
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(reject, new Error(`claude session timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      child.on('close', (code) => {
        const out = Buffer.concat(stdout).toString().trim();
        const err = Buffer.concat(stderr).toString().trim();

        if (code === 0 && out) {
          settle(resolve, out);
        } else if (out) {
          // Non-zero exit but has output — use it
          settle(resolve, out);
        } else {
          settle(reject, new Error(err || `claude exited with code ${code}`));
        }
      });
    });
  }

  // ---- Stateless fallback -------------------------------------------------

  private statelessRun(
    backend: string,
    systemPrompt: string,
    prompt: string,
    repoPath: string,
    model?: string,
  ): Promise<string> {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    return this.execBackend(backend, fullPrompt, repoPath, model);
  }

  private statelessResume(
    session: SessionInfo,
    newMessage: string,
    repoPath: string,
  ): Promise<string> {
    // Replay conversation as context
    const transcript = session.history
      .map((msg, i) => i % 2 === 0 ? `[Turn ${Math.floor(i / 2) + 1} prompt]: ${msg}` : `[Turn ${Math.floor(i / 2) + 1} response]: ${msg}`)
      .join('\n\n---\n\n');

    const fullPrompt = `${transcript}\n\n---\n\n[New message]: ${newMessage}`;
    return this.execBackend(session.backend, fullPrompt, repoPath);
  }

  private execBackend(
    backend: string,
    prompt: string,
    repoPath: string,
    model?: string,
  ): Promise<string> {
    // For now, only Claude is supported in agentic mode.
    // Other backends can be added by implementing their CLI args here.
    return Promise.reject(
      new Error(`Backend "${backend}" is not yet supported in agentic mode. Use claude.`),
    );
  }

  // ---- Helpers ------------------------------------------------------------

  private cleanEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of NESTED_SESSION_VARS) {
      delete env[key];
    }
    return env;
  }
}

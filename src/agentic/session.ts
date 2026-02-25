/**
 * Session manager for agentic mode.
 *
 * Wraps backend CLIs with session persistence. Claude is the primary
 * backend (UUID-based sessions). Other backends fall back to transcript
 * replay via run().
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AgentConfig } from './types.js';

// Env vars that trigger Claude's nested-session guard
const NESTED_SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION'];

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
    const sessionId = randomUUID();

    switch (agent.backend) {
      case 'claude': {
        const output = await this.spawnClaude(
          sessionId, systemPrompt, initialPrompt, repoPath, agent.model,
        );
        this.sessions.set(agent.name, {
          agentName: agent.name,
          backend: 'claude',
          sessionId,
          history: [initialPrompt, output],
        });
        return { output, sessionId };
      }

      default: {
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
    }
  }

  /**
   * Resume an agent session with a new message. Returns the agent's response.
   */
  async resume(agentName: string, message: string, repoPath: string): Promise<string> {
    const session = this.sessions.get(agentName);
    if (!session) throw new Error(`No session for agent: ${agentName}`);

    // Don't mutate history until backend succeeds — avoids phantom messages on failure
    switch (session.backend) {
      case 'claude': {
        const output = await this.resumeClaude(session.sessionId, message, repoPath);
        session.history.push(message, output);
        return output;
      }

      default: {
        const output = await this.statelessResume(session, message, repoPath);
        session.history.push(message, output);
        return output;
      }
    }
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

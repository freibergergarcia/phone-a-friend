/**
 * Claude Code CLI backend implementation.
 *
 * Subprocess backend using the `claude` CLI in print mode (`-p`).
 * Supports streaming via `--output-format stream-json` and session
 * persistence via `--session-id` / `-r` (planned for Phase 3).
 *
 * Sandbox is mapped to `--tools` + `--allowedTools` (tool policy, not OS sandbox).
 * Claude has no `-C` flag — use `cwd` in spawn/exec options instead.
 */

import { execFileSync, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  type BackendCapabilities,
  type BackendRunOptions,
  BackendError,
  type ClaudePeerMessagingMode,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  spawnCli,
  SpawnCliError,
  type Backend,
  type SandboxMode,
} from './index.js';
import { ownProcessGroup, superviseChild } from './child-supervisor.js';
import { parseClaudeStreamJSON } from '../stream-parsers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const READ_ONLY_TOOLS = 'Read,Grep,Glob,LS,WebFetch,WebSearch';
const WORKSPACE_WRITE_TOOLS = 'Read,Grep,Glob,LS,Edit,Write,WebFetch,WebSearch';
const PEER_MESSAGING_TOOLS = 'ListAgents,SendMessage';
const CLAUDE_PEER_MESSAGING_MIN_VERSION = [2, 1, 224] as const;

/** Env vars that trigger Claude's nested-session guard. Strip before spawning. */
const NESTED_SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION'] as const;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ClaudeBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeBackendError';
  }
}

/**
 * Specialization of ClaudeBackendError for the "Not logged in" case.
 * Surfaces a clear remediation step so callers (skills, doctor, agents)
 * know exactly what the user needs to do.
 *
 * The remediation text is context-aware: when the relay is invoked from
 * inside Codex (PHONE_A_FRIEND_HOST=codex), the "Not logged in" error is
 * almost certainly Codex's workspace-write sandbox blocking subprocess
 * keychain access — NOT a genuine auth issue. Reproduce: a `claude -p`
 * subprocess that succeeds at the terminal will fail with "Not logged in"
 * when run inside `codex exec --sandbox workspace-write`. The fix is to
 * relax the sandbox, not to re-authenticate.
 */
export class ClaudeAuthError extends ClaudeBackendError {
  /** Human-readable remediation instruction. */
  readonly remediation: string;
  constructor(remediation?: string) {
    super('Claude CLI is not authenticated.');
    this.name = 'ClaudeAuthError';
    this.remediation = remediation ?? defaultClaudeRemediation();
  }
}

/**
 * Compose the right remediation string based on the calling host.
 * - From Codex: blame the sandbox first (the most common cause).
 * - From other hosts or unknown: blame the auth state.
 */
export function defaultClaudeRemediation(host: string = process.env.PHONE_A_FRIEND_HOST ?? ''): string {
  if (host === 'codex') {
    return (
      'Codex is running with a sandbox that blocks Claude\'s keychain access. ' +
      'Re-run Codex with `codex --sandbox danger-full-access`, ' +
      'or escalate this specific command via the approval prompt. ' +
      'This is NOT a Claude login problem — `claude -p` works fine outside the Codex sandbox.'
    );
  }
  return 'Run `claude` interactively, then `/login` to authenticate. Or export ANTHROPIC_API_KEY.';
}

/**
 * Detect the well-known "Not logged in" stderr / stdout markers Claude CLI
 * emits when no OAuth session is available. Used to convert raw subprocess
 * errors into a structured auth error.
 */
export function isClaudeAuthError(msg: string): boolean {
  // Claude CLI prints variations like:
  //   "Not logged in · Please run /login"
  //   "Please run /login"
  //   "You are not logged in."
  const text = msg.toLowerCase();
  return text.includes('not logged in') || text.includes('please run /login');
}

const CLAUDE_VERSION_PROBE_TIMEOUT_SECONDS = 3;

/** Whether a `claude --version` response supports cross-session messaging. */
export function supportsClaudePeerMessaging(versionOutput: string): boolean {
  const match = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  for (let i = 0; i < CLAUDE_PEER_MESSAGING_MIN_VERSION.length; i++) {
    if (version[i] > CLAUDE_PEER_MESSAGING_MIN_VERSION[i]) return true;
    if (version[i] < CLAUDE_PEER_MESSAGING_MIN_VERSION[i]) return false;
  }
  return true;
}

/** Stable, human-readable name shown by Claude's `/list-agents`. */
export function claudePeerName(sessionLabel?: string | null, sessionId?: string | null): string {
  const source = sessionLabel?.trim() || sessionId?.slice(0, 8) || 'relay';
  const slug = source
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!slug) return 'paf-relay';
  return slug.startsWith('paf-') ? slug : `paf-${slug}`;
}

/**
 * Extract the schema payload from Claude's `--output-format json` envelope.
 *
 * With `--json-schema`, Claude Code returns the full result envelope
 * (`{type, subtype, result, structured_output, ...}`) on stdout, and the
 * schema-conforming value lives under `.structured_output`. Returning the raw
 * envelope leaks the wrapper to callers (e.g. `jq '.ok'` yields null) and is
 * inconsistent with the Codex backend, which returns the clean value.
 *
 * We extract `.structured_output` whenever the parsed envelope owns that key,
 * serializing whatever value it holds — JSON Schema roots can be objects,
 * arrays, strings, numbers, booleans, or null, so we must NOT restrict to
 * object values. If the envelope can't be parsed or has no `structured_output`
 * key, we fall back to the raw stdout rather than swallowing output.
 *
 * Only used in schema mode; plain-text runs return stdout verbatim.
 */
export function extractClaudeSchemaOutput(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return stdout;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.prototype.hasOwnProperty.call(parsed, 'structured_output')
  ) {
    return JSON.stringify((parsed as Record<string, unknown>).structured_output);
  }
  return stdout;
}

/**
 * The `--max-turns` value for a relay: `CLAUDE_MAX_TURNS` when it is set, and
 * no limit otherwise. PaF used to pass 10 by default, which ended a task that
 * needed an eleventh turn without an answer; a relay is bounded by `--timeout`
 * (and `CLAUDE_MAX_BUDGET`), as for every other backend. Without the flag
 * Claude sets no limit of its own: a 14-turn run completed on 2.1.322.
 */
function claudeMaxTurns(env: Record<string, string>): string | null {
  const value = env.CLAUDE_MAX_TURNS?.trim();
  return value ? value : null;
}

/**
 * Whether Claude's stdout says the run ended at `--max-turns`. Claude exits 1
 * and reports it on stdout only: `Error: Reached max turns (N)` in text mode,
 * a result envelope with `subtype: "error_max_turns"` in JSON mode (verified
 * on 2.1.322). stderr holds unrelated warnings at that point, which is what
 * the relay printed before this check.
 */
export function isClaudeTurnLimit(stdout: string): boolean {
  if (/^Error: Reached max turns \(\d+\)\s*$/m.test(stdout)) return true;
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return isClaudeTurnLimitResult(parsed);
  } catch {
    return false;
  }
}

/** The same check for one parsed `result` event (JSON envelope or stream line). */
export function isClaudeTurnLimitResult(event: unknown): boolean {
  return typeof event === 'object'
    && event !== null
    && (event as Record<string, unknown>).type === 'result'
    && (event as Record<string, unknown>).subtype === 'error_max_turns';
}

function claudeTurnLimitMessage(maxTurns: string | null): string {
  // Without CLAUDE_MAX_TURNS PaF passes no limit, so this one came from Claude's own settings.
  if (maxTurns === null) {
    return 'Claude stopped at a turn limit before giving an answer. PaF set none for this run, so it comes from Claude Code itself.';
  }
  return (
    `Claude stopped at its turn limit (${maxTurns} ${maxTurns === '1' ? 'turn' : 'turns'}) before giving an answer. ` +
    'The limit comes from the CLAUDE_MAX_TURNS environment variable: raise it, or unset it for no limit.'
  );
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export class ClaudeBackend implements Backend {
  readonly name = 'claude';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'native-session',
    requiresClientSessionId: true,
  };

  /**
   * Strip env vars that trigger Claude's nested-session guard.
   * Without this, spawning claude from inside a Claude Code session fails with:
   * "Claude Code cannot be launched inside another Claude Code session."
   */
  private cleanEnv(env: Record<string, string>): Record<string, string> {
    const cleaned = { ...env };
    for (const key of NESTED_SESSION_VARS) {
      delete cleaned[key];
    }
    return cleaned;
  }

  /**
   * Build the common CLI args shared by run() and runStream().
   */
  private buildArgs(opts: {
    prompt: string;
    repoPath: string;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
    outputFormat?: string;
    schema?: string | null;
    fast?: boolean;
    sessionId?: string | null;
    resumeSession?: boolean;
    peerMessaging?: ClaudePeerMessagingMode;
    peerMessagingSupported?: boolean;
    sessionLabel?: string | null;
  }): string[] {
    const args: string[] = ['-p', opts.prompt];

    if (opts.sessionId) {
      if (opts.resumeSession) {
        args.push('-r', opts.sessionId);
      } else {
        args.push('--session-id', opts.sessionId);
      }
    }

    // Repo access
    if (!opts.resumeSession) {
      args.push('--add-dir', opts.repoPath);
    }

    // Output format
    if (opts.schema) {
      args.push('--output-format', 'json', '--json-schema', opts.schema);
    } else if (opts.outputFormat) {
      args.push('--output-format', opts.outputFormat);
    }

    // Model
    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Max turns: only when CLAUDE_MAX_TURNS asks for one
    const maxTurns = claudeMaxTurns(opts.env);
    if (maxTurns !== null) {
      args.push('--max-turns', maxTurns);
    }

    // Max budget (from env, optional)
    const maxBudget = opts.env.CLAUDE_MAX_BUDGET;
    if (maxBudget) {
      args.push('--max-budget-usd', maxBudget);
    }

    const peerMessaging = opts.peerMessaging ?? 'native';
    const peerMessagingEnabled = opts.peerMessagingSupported && peerMessaging !== 'refuse';

    // Sandbox → tool policy
    if (opts.sandbox === 'danger-full-access') {
      args.push('--dangerously-skip-permissions');
    } else {
      let tools = opts.sandbox === 'read-only'
        ? READ_ONLY_TOOLS
        : WORKSPACE_WRITE_TOOLS;
      if (peerMessagingEnabled) {
        tools += `,${PEER_MESSAGING_TOOLS}`;
      }
      args.push('--tools', tools);
      args.push('--allowedTools', tools);
    }

    if (opts.peerMessagingSupported) {
      if (peerMessaging === 'accept' || peerMessaging === 'refuse') {
        args.push('--settings', JSON.stringify({ crossSessionInbound: peerMessaging }));
      }
      if (peerMessagingEnabled) {
        args.push('--name', claudePeerName(opts.sessionLabel, opts.sessionId));
      }
    }

    // Depth guard: prevent recursion via skills and subagents
    args.push('--disable-slash-commands');
    const disallowedTools = opts.peerMessagingSupported && peerMessaging === 'refuse'
      ? 'Task,SendMessage,ListAgents'
      : 'Task';
    args.push('--disallowedTools', disallowedTools);

    // Intentionally ignore opts.fast for Claude. `--bare` skips OAuth/keychain
    // reads and breaks subscription auth; API-key users may be fine, but PaF
    // cannot reliably detect that auth mode.

    // Ephemeral by default (print mode persists sessions otherwise)
    if (!opts.sessionId) {
      args.push('--no-session-persistence');
    }

    return args;
  }

  async run(opts: BackendRunOptions): Promise<string> {
    if (!isInPath('claude')) {
      throw new ClaudeBackendError(
        `claude CLI not found in PATH. Install it: ${INSTALL_HINTS.claude}`,
      );
    }

    const peerMessagingSupported = this.peerMessagingSupported(opts.peerMessaging);

    const args = this.buildArgs({
      ...opts,
      outputFormat: opts.schema ? undefined : 'text',
      peerMessagingSupported,
    });

    try {
      const result = await spawnCli('claude', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: this.cleanEnv(opts.env),
        cwd: opts.repoPath,
        label: 'claude',
      });

      if (result.stdout) {
        return opts.schema
          ? extractClaudeSchemaOutput(result.stdout)
          : result.stdout;
      }

      throw new ClaudeBackendError('claude completed without producing output');
    } catch (err: unknown) {
      if (err instanceof ClaudeBackendError) throw err;
      // Before the stderr-based checks: at the turn limit stderr is unrelated.
      if (err instanceof SpawnCliError && isClaudeTurnLimit(err.stdout)) {
        throw new ClaudeBackendError(claudeTurnLimitMessage(claudeMaxTurns(opts.env)));
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (isClaudeAuthError(msg)) {
        throw new ClaudeAuthError();
      }
      if (err instanceof BackendError) {
        throw new ClaudeBackendError(err.message);
      }
      throw new ClaudeBackendError(msg);
    }
  }

  async *runStream(opts: BackendRunOptions): AsyncGenerator<string> {
    if (!isInPath('claude')) {
      throw new ClaudeBackendError(
        `claude CLI not found in PATH. Install it: ${INSTALL_HINTS.claude}`,
      );
    }

    const peerMessagingSupported = this.peerMessagingSupported(opts.peerMessaging);

    const args = this.buildArgs({
      ...opts,
      outputFormat: 'stream-json',
      peerMessagingSupported,
    });

    // --output-format stream-json requires --verbose in print mode
    args.push('--verbose');
    // Add --include-partial-messages for incremental streaming
    args.push('--include-partial-messages');

    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.repoPath,
      env: this.cleanEnv(opts.env),
      ...ownProcessGroup(),
    });
    const supervisor = superviseChild(child, { timeoutMs: opts.timeoutSeconds * 1000 });

    // Drain stderr to prevent pipe backpressure stalling the child
    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let reachedTurnLimit = false;
    try {
      yield* parseClaudeStreamJSON(child.stdout as Readable, {
        onResult: (event) => {
          if (isClaudeTurnLimitResult(event)) reachedTurnLimit = true;
        },
      });
      // Parser succeeded — verify process exited cleanly
      const { code, signal, spawnError } = await supervisor.exit;
      if (spawnError) {
        throw new ClaudeBackendError(`claude failed to start: ${spawnError.message}`);
      }
      if (supervisor.timedOut) {
        throw new ClaudeBackendError(`claude timed out after ${opts.timeoutSeconds}s`);
      }
      if (supervisor.interruptedBy) {
        throw new ClaudeBackendError(`claude interrupted by ${supervisor.interruptedBy}`);
      }
      if (signal) {
        throw new ClaudeBackendError(`claude killed by signal ${signal}`);
      }
      if (code !== 0 && code !== null) {
        if (reachedTurnLimit) {
          throw new ClaudeBackendError(claudeTurnLimitMessage(claudeMaxTurns(opts.env)));
        }
        const stderr = Buffer.concat(stderrChunks).toString().trim();
        const errMsg = stderr || `claude exited with code ${code}`;
        if (isClaudeAuthError(errMsg)) throw new ClaudeAuthError();
        throw new ClaudeBackendError(errMsg);
      }
    } catch (err: unknown) {
      if (err instanceof ClaudeBackendError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (supervisor.timedOut) {
        throw new ClaudeBackendError(`claude timed out after ${opts.timeoutSeconds}s`);
      }
      throw new ClaudeBackendError(`claude stream error: ${msg}`);
    } finally {
      // Reached early when the parser fails or the consumer stops reading: do
      // not leave claude running, and do not return before it is gone.
      if (!supervisor.ended) {
        supervisor.terminate();
        await supervisor.exit;
      }
    }
  }

  /** The `claude --version` output, or why it could not be used. */
  private readClaudeVersion(): { version: string; failure: null } | { version: null; failure: string } {
    let output: string;
    try {
      output = execFileSync('claude', ['--version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        // This runs before the relay timer. Bound both time and output, and
        // avoid waiting forever for a launcher that ignores SIGTERM.
        timeout: CLAUDE_VERSION_PROBE_TIMEOUT_SECONDS * 1000,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024,
      });
    } catch (err: unknown) {
      const timedOut = (err as NodeJS.ErrnoException).code === 'ETIMEDOUT';
      return {
        version: null,
        failure: timedOut
          ? `\`claude --version\` did not finish within ${CLAUDE_VERSION_PROBE_TIMEOUT_SECONDS}s`
          : '`claude --version` failed',
      };
    }
    return /\d+\.\d+\.\d+/.test(output)
      ? { version: output, failure: null }
      : { version: null, failure: '`claude --version` printed no version' };
  }

  /**
   * Decide whether this relay may use peer messaging. An unreadable version is
   * not an old version: `accept` and `refuse` are explicit requests PaF cannot
   * honor without knowing, so they fail; `native` keeps the older tool set, says
   * so, and leaves peer messaging out.
   */
  private peerMessagingSupported(mode: ClaudePeerMessagingMode | undefined): boolean {
    const { version, failure } = this.readClaudeVersion();
    if (version === null) {
      if (mode === 'accept' || mode === 'refuse') {
        throw new ClaudeBackendError(
          `Could not confirm Claude Code's version for --peer-messaging ${mode}: ${failure}. ` +
            'Retry, or use --peer-messaging native.',
        );
      }
      process.stderr.write(
        `[phone-a-friend] Could not confirm Claude Code's version: ${failure}. ` +
          'Continuing without peer messaging.\n',
      );
      return false;
    }

    const supported = supportsClaudePeerMessaging(version);
    if (mode === 'accept' && !supported) {
      throw new ClaudeBackendError(
        'Claude peer messaging requires Claude Code v2.1.224 or later. ' +
          'Upgrade Claude Code or use --peer-messaging native.',
      );
    }
    return supported;
  }
}

export const CLAUDE_BACKEND = new ClaudeBackend();
registerBackend(CLAUDE_BACKEND);

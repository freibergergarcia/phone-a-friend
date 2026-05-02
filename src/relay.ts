/**
 * Backend-agnostic relay helpers.
 *
 * Ported from phone_a_friend/relay.py
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getBackend, BackendError, type Backend, type SandboxMode } from './backends/index.js';
import { JobManager, type Job } from './jobs.js';
import { SessionStore } from './sessions.js';
import { VERDICT_SCHEMA_JSON, buildVerdictPrompt } from './verdict.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_BACKEND = 'codex';
export const DEFAULT_SANDBOX: SandboxMode = 'read-only';
export const MAX_RELAY_DEPTH = 1;
export const MAX_CONTEXT_FILE_BYTES = 200_000;
export const MAX_DIFF_BYTES = 300_000;
export const MAX_PROMPT_BYTES = 500_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sizeBytes(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

function ensureSizeLimit(label: string, text: string, maxBytes: number): void {
  const size = sizeBytes(text);
  if (size > maxBytes) {
    throw new RelayError(`${label} is too large (${size} bytes; max ${maxBytes} bytes)`);
  }
}

function readContextFile(contextFile: string | null): string {
  if (contextFile === null) return '';
  const resolved = resolve(contextFile);
  if (!existsSync(resolved)) {
    throw new RelayError(`Context file does not exist: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw new RelayError(`Context path is not a file: ${resolved}`);
  }
  try {
    const contents = readFileSync(resolved, 'utf-8').trim();
    ensureSizeLimit('Context file', contents, MAX_CONTEXT_FILE_BYTES);
    return contents;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    throw new RelayError(`Failed reading context file: ${err}`);
  }
}

function resolveContextText(contextFile: string | null, contextText: string | null): string {
  const fileText = readContextFile(contextFile);
  const inlineText = (contextText ?? '').trim();
  if (contextFile !== null && inlineText) {
    throw new RelayError('Use either context_file or context_text, not both');
  }
  if (inlineText) {
    ensureSizeLimit('Context text', inlineText, MAX_CONTEXT_FILE_BYTES);
    return inlineText;
  }
  return fileText;
}

function tryGitDiff(repoPath: string, args: string[]): string {
  try {
    const result = execFileSync('git', ['-C', repoPath, 'diff', ...args], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const diffText = result.trim();
    ensureSizeLimit('Git diff', diffText, MAX_DIFF_BYTES);
    return diffText;
  } catch (err: unknown) {
    if (err instanceof RelayError) throw err; // size limit — propagate
    return ''; // git failure — treat as empty
  }
}

function gitDiff(repoPath: string): string {
  // 1. Uncommitted changes (staged + unstaged) vs HEAD
  const uncommitted = tryGitDiff(repoPath, ['HEAD', '--']);
  if (uncommitted) return uncommitted;

  // 2. Last commit's changes (for already-committed work)
  return tryGitDiff(repoPath, ['HEAD~1', 'HEAD', '--']);
}

export function detectDefaultBranch(repoPath: string): string {
  for (const branch of ['main', 'master']) {
    try {
      execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', branch], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return branch;
    } catch {
      // Branch doesn't exist, try next
    }
  }
  return 'HEAD~1';
}

export function gitDiffBase(repoPath: string, base: string): string {
  try {
    const result = execFileSync('git', ['-C', repoPath, 'diff', `${base}...HEAD`, '--'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const diffText = result.trim();
    ensureSizeLimit('Git diff', diffText, MAX_DIFF_BYTES);
    return diffText;
  } catch (err: unknown) {
    if (err instanceof RelayError) throw err;
    const execErr = err as NodeJS.ErrnoException & {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    const detail = execErr.stderr?.toString().trim() || execErr.stdout?.toString().trim() || 'git diff failed';
    throw new RelayError(`Failed to collect git diff against ${base}: ${detail}`);
  }
}

function buildPrompt(opts: {
  prompt: string;
  repoPath: string;
  contextText: string;
  diffText: string;
  localFileAccess: boolean;
}): string {
  const sections = [
    'You are helping another coding agent by reviewing or advising on work in a local repository.',
  ];

  if (opts.localFileAccess) {
    sections.push(
      `Repository path: ${opts.repoPath}`,
      'Use the repository files for context when needed.',
    );
  }

  sections.push(
    'Respond with concise, actionable feedback.',
    '',
    'Request:',
    opts.prompt.trim(),
  );

  if (opts.contextText) {
    sections.push('', 'Additional Context:', opts.contextText);
  }

  if (opts.diffText) {
    sections.push('', 'Git Diff:', opts.diffText);
  }

  return sections.join('\n').trim();
}

function nextRelayEnv(): Record<string, string> {
  const depthRaw = process.env.PHONE_A_FRIEND_DEPTH ?? '0';
  // Match Python's strict int() — reject partial numeric strings like "1abc"
  const depth = /^\d+$/.test(depthRaw) ? Number(depthRaw) : 0;

  if (depth >= MAX_RELAY_DEPTH) {
    throw new RelayError('Relay depth limit reached; refusing nested relay invocation');
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.PHONE_A_FRIEND_DEPTH = String(depth + 1);
  return env;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReviewRelayOptions {
  repoPath: string;
  backend?: string;
  base?: string;
  prompt?: string;
  timeoutSeconds?: number;
  model?: string | null;
  sandbox?: SandboxMode;
  schema?: string | null;
  fast?: boolean;
  /**
   * Request a verdict JSON envelope (see src/verdict.ts). When true, the
   * caller's prompt is replaced with the canonical verdict prompt, the
   * schema is replaced with VERDICT_SCHEMA_JSON, and the native review()
   * path is bypassed so schema enforcement is consistent across backends.
   * The raw response should be passed to parseVerdict() by the caller.
   */
  verdictJson?: boolean;
}

export interface RelayOptions {
  prompt: string;
  repoPath: string;
  backend?: string;
  contextFile?: string | null;
  contextText?: string | null;
  includeDiff?: boolean;
  timeoutSeconds?: number;
  model?: string | null;
  sandbox?: SandboxMode;
  schema?: string | null;
  session?: string | null;
  /** Raw backend session/thread ID. Bypasses PaF's label store and resumes
   *  the backend session directly. May be combined with `session` to also
   *  start tracking that backend session under a PaF label (adoption). */
  backendSession?: string | null;
  fast?: boolean;
  sessionStore?: SessionStore;
}

export interface BackgroundRelayOptions extends RelayOptions {
  jobManager?: JobManager;
}

interface PreparedRelay {
  selectedBackend: Backend;
  fullPrompt: string;
  resolvedRepo: string;
  env: Record<string, string>;
  timeoutSeconds: number;
  sandbox: SandboxMode;
  model: string | null;
  schema: string | null;
  session: string | null;
  backendSession: string | null;
  fast: boolean;
  sessionStore?: SessionStore;
}

function prepareRelay(opts: RelayOptions): PreparedRelay {
  const {
    prompt,
    repoPath,
    backend = DEFAULT_BACKEND,
    contextFile = null,
    contextText = null,
    includeDiff = false,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    model = null,
    sandbox = DEFAULT_SANDBOX,
    schema = null,
    session = null,
    backendSession = null,
    fast = false,
  } = opts;

  if (!prompt.trim()) {
    throw new RelayError('Prompt is required');
  }
  if (timeoutSeconds <= 0) {
    throw new RelayError('Timeout must be greater than zero');
  }

  const resolvedRepo = resolve(repoPath);
  if (!existsSync(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
    throw new RelayError(
      `Repository path does not exist or is not a directory: ${resolvedRepo}`,
    );
  }

  let selectedBackend;
  try {
    selectedBackend = getBackend(backend);
  } catch (err) {
    throw new RelayError(String((err as Error).message));
  }

  if (!selectedBackend.allowedSandboxes.has(sandbox)) {
    const allowed = [...selectedBackend.allowedSandboxes].sort().join(', ');
    throw new RelayError(`Invalid sandbox mode: ${sandbox}. Allowed values: ${allowed}`);
  }

  if (backendSession && selectedBackend.capabilities.resumeStrategy !== 'native-session') {
    throw new RelayError(
      `--backend-session is not supported by the ${selectedBackend.name} backend ` +
        `(resume strategy: ${selectedBackend.capabilities.resumeStrategy}).`,
    );
  }

  if (session && selectedBackend.capabilities.resumeStrategy === 'unsupported') {
    throw new RelayError(
      `--session is not supported by the ${selectedBackend.name} backend ` +
        `(resume strategy: unsupported). The backend cannot resume a prior conversation, ` +
        `so PaF refuses to persist a label that would silently fresh-spawn each call.`,
    );
  }

  const resolvedContext = resolveContextText(contextFile, contextText);
  const diffText = includeDiff ? gitDiff(resolvedRepo) : '';
  const fullPrompt = buildPrompt({
    prompt,
    repoPath: resolvedRepo,
    contextText: resolvedContext,
    diffText,
    localFileAccess: selectedBackend.localFileAccess,
  });
  ensureSizeLimit('Relay prompt', fullPrompt, MAX_PROMPT_BYTES);

  const env = nextRelayEnv();

  return {
    selectedBackend,
    fullPrompt,
    resolvedRepo,
    env,
    timeoutSeconds,
    sandbox,
    model,
    schema,
    session,
    backendSession,
    fast,
    sessionStore: opts.sessionStore,
  };
}

export async function relay(opts: RelayOptions): Promise<string> {
  const {
    selectedBackend,
    fullPrompt,
    resolvedRepo,
    env,
    timeoutSeconds,
    sandbox,
    model,
    schema,
    session,
    backendSession,
    fast,
    sessionStore,
  } = prepareRelay(opts);

  try {
    // --- Path A: --backend-session (raw passthrough, with optional adoption) ---
    if (backendSession) {
      const store = session ? (sessionStore ?? new SessionStore()) : null;
      const existing = session && store ? store.get(session) : null;

      if (existing) {
        const conflicts: string[] = [];
        if (existing.backend !== selectedBackend.name) {
          conflicts.push(`backend "${existing.backend}" (expected "${selectedBackend.name}")`);
        }
        if (existing.backendSessionId && existing.backendSessionId !== backendSession) {
          conflicts.push(`backend session "${existing.backendSessionId}" (expected "${backendSession}")`);
        }
        if (existing.repoPath !== resolvedRepo) {
          conflicts.push(`repo "${existing.repoPath}" (expected "${resolvedRepo}")`);
        }
        if (conflicts.length > 0) {
          throw new RelayError(
            `Session label "${session}" already exists with conflicting metadata: ${conflicts.join('; ')}. ` +
              `Use a different label or remove the existing entry.`,
          );
        }
      }

      let createdSessionId: string | null = backendSession;
      const result = await selectedBackend.run({
        prompt: fullPrompt,
        repoPath: resolvedRepo,
        timeoutSeconds,
        sandbox,
        model,
        env,
        schema,
        sessionId: backendSession,
        persistSession: Boolean(session),
        resumeSession: true,
        fast,
        sessionHistory: existing?.history ?? [],
        onSessionCreated: (newSessionId) => {
          createdSessionId = newSessionId;
        },
      });

      if (session && store) {
        persistRelaySession(
          store,
          session,
          selectedBackend,
          resolvedRepo,
          fullPrompt,
          result,
          createdSessionId,
        );
      }

      return result;
    }

    // --- Path B: --session label only (PaF-managed) ---
    const store = session ? (sessionStore ?? new SessionStore()) : null;
    const storedSession = session ? store?.get(session) ?? null : null;

    if (storedSession && storedSession.backend !== selectedBackend.name) {
      throw new RelayError(
        `Session ${session} belongs to backend ${storedSession.backend}, not ${selectedBackend.name}`,
      );
    }

    if (storedSession && storedSession.repoPath !== resolvedRepo) {
      throw new RelayError(
        `Session ${session} belongs to a different repository: ${storedSession.repoPath}`,
      );
    }

    if (session && !storedSession) {
      console.error(
        `[phone-a-friend] Session label "${session}" not found in store. ` +
          `Starting a fresh session under this label. ` +
          `If you meant to attach to an existing backend thread, use --backend-session <id>.`,
      );
    }

    let backendSessionId = storedSession?.backendSessionId ?? null;
    if (session && !storedSession && selectedBackend.capabilities.requiresClientSessionId) {
      backendSessionId = randomUUID();
    }

    const requiresNativeSession = selectedBackend.capabilities.resumeStrategy === 'native-session';
    if (session && storedSession && !backendSessionId && requiresNativeSession) {
      throw new RelayError(`Session ${session} is missing native ${selectedBackend.name} session metadata`);
    }

    let createdSessionId = backendSessionId;
    const result = await selectedBackend.run({
      prompt: fullPrompt,
      repoPath: resolvedRepo,
      timeoutSeconds,
      sandbox,
      model,
      env,
      schema,
      sessionId: backendSessionId,
      persistSession: Boolean(session),
      resumeSession: Boolean(session && storedSession),
      fast,
      sessionHistory: storedSession?.history ?? [],
      onSessionCreated: (newSessionId) => {
        createdSessionId = newSessionId;
      },
    });

    if (session && store) {
      persistRelaySession(
        store,
        session,
        selectedBackend,
        resolvedRepo,
        fullPrompt,
        result,
        createdSessionId,
      );
    }

    return result;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof BackendError) {
      throw new RelayError(err.message);
    }
    throw err;
  }
}

function persistRelaySession(
  store: SessionStore,
  id: string,
  backend: Backend,
  repoPath: string,
  prompt: string,
  output: string,
  backendSessionId: string | null,
): void {
  // Only transcript-replay backends actually use the stored history on resume.
  // Native-session backends (Codex/Claude/OpenCode) resume via their own server-side
  // state; the history field is dead weight that only inflates the JSON store.
  // Anything else (`unsupported`) doesn't replay either.
  const replaysHistory = backend.capabilities.resumeStrategy === 'transcript-replay';

  if (replaysHistory) {
    store.upsert({
      id,
      backend: backend.name,
      repoPath,
      backendSessionId: backendSessionId ?? undefined,
      historyAppend: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: output },
      ],
    });
    return;
  }

  // Non-replay backend: keep history empty. If the row was created before this
  // policy and has accumulated entries, replaceHistory clears them on first write.
  store.upsert({
    id,
    backend: backend.name,
    repoPath,
    backendSessionId: backendSessionId ?? undefined,
    replaceHistory: [],
  });
}

/**
 * Streaming relay. Session options are forwarded to the backend for resume
 * support, but session lifecycle (validation, UUID generation, history
 * persistence) is not implemented here. The CLI disables streaming when
 * --session is active, so this gap only affects programmatic callers.
 * Full session support in streaming mode would require buffering the
 * complete response to persist history, which defeats the streaming purpose.
 */
export async function* relayStream(opts: RelayOptions): AsyncGenerator<string> {
  const {
    selectedBackend,
    fullPrompt,
    resolvedRepo,
    env,
    timeoutSeconds,
    sandbox,
    model,
    schema,
    session,
    backendSession,
    fast,
    sessionStore,
  } = prepareRelay(opts);

  // Session support: look up stored session for resume context (skipped when
  // --backend-session is set, since that path bypasses the label store).
  const store = session && !backendSession ? (sessionStore ?? new SessionStore()) : null;
  const storedSession = session && !backendSession ? store?.get(session) ?? null : null;

  const runOpts = {
    prompt: fullPrompt,
    repoPath: resolvedRepo,
    timeoutSeconds,
    sandbox,
    model,
    env,
    schema,
    fast,
    sessionId: backendSession ?? storedSession?.backendSessionId ?? null,
    persistSession: Boolean(session),
    resumeSession: Boolean(backendSession || (session && storedSession)),
    sessionHistory: storedSession?.history ?? [],
  };

  try {
    if (typeof selectedBackend.runStream === 'function') {
      yield* selectedBackend.runStream(runOpts);
    } else {
      yield await selectedBackend.run(runOpts);
    }
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof BackendError) {
      throw new RelayError(err.message);
    }
    throw err;
  }
}

export async function reviewRelay(opts: ReviewRelayOptions): Promise<string> {
  const verdictJson = Boolean(opts.verdictJson);
  // For verdict mode, compose the caller's review request with the envelope
  // instructions instead of replacing the request outright. The caller's
  // intent (e.g. "focus on the auth module") must survive structured output.
  const effectivePrompt = verdictJson
    ? buildVerdictPrompt(opts.prompt ?? null)
    : opts.prompt;
  const effectiveSchema = verdictJson ? VERDICT_SCHEMA_JSON : (opts.schema ?? null);

  const {
    repoPath,
    backend = DEFAULT_BACKEND,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    model = null,
    sandbox = DEFAULT_SANDBOX,
    fast = false,
  } = opts;
  const prompt = effectivePrompt;
  const schema = effectiveSchema;

  if (timeoutSeconds <= 0) {
    throw new RelayError('Timeout must be greater than zero');
  }

  const resolvedRepo = resolve(repoPath);
  if (!existsSync(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
    throw new RelayError(
      `Repository path does not exist or is not a directory: ${resolvedRepo}`,
    );
  }

  let selectedBackend;
  try {
    selectedBackend = getBackend(backend);
  } catch (err) {
    throw new RelayError(String((err as Error).message));
  }

  if (!selectedBackend.allowedSandboxes.has(sandbox)) {
    const allowed = [...selectedBackend.allowedSandboxes].sort().join(', ');
    throw new RelayError(`Invalid sandbox mode: ${sandbox}. Allowed values: ${allowed}`);
  }

  const base = opts.base ?? detectDefaultBranch(resolvedRepo);
  const env = nextRelayEnv();

  // If backend supports review(), use it directly.
  // Skip native review when:
  //   - a custom prompt is provided — Codex exec review cannot combine
  //     --base with a positional prompt, so the generic run() path (which
  //     includes the prompt alongside the diff) gives better results.
  //   - a schema is set — native review() does not forward schema to the
  //     backend's structured output enforcement, so the schema would be
  //     silently dropped. Use the generic run() path which honors schema.
  if (typeof selectedBackend.review === 'function' && !prompt && !schema) {
    try {
      return await selectedBackend.review({
        repoPath: resolvedRepo,
        timeoutSeconds,
        sandbox,
        model,
        env,
        base,
        prompt,
      });
    } catch (err) {
      // Fallback to run() with diff on review() failure
      if (err instanceof RelayError) {
        // Re-throw relay errors (depth limit, etc.)
        throw err;
      }
      // Log warning and fall through to generic path
      console.error(`[phone-a-friend] review() failed, falling back to generic relay: ${(err as Error).message}`);
    }
  }

  // Generic path: get diff and build prompt with it
  const diffText = gitDiffBase(resolvedRepo, base);
  const reviewPrompt = prompt ?? 'Review the following changes.';
  const fullPrompt = buildPrompt({
    prompt: reviewPrompt,
    repoPath: resolvedRepo,
    contextText: '',
    diffText,
    localFileAccess: selectedBackend.localFileAccess,
  });
  ensureSizeLimit('Relay prompt', fullPrompt, MAX_PROMPT_BYTES);

  try {
    return await selectedBackend.run({
      prompt: fullPrompt,
      repoPath: resolvedRepo,
      timeoutSeconds,
      sandbox,
      model,
      env,
      schema,
      fast,
    });
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof BackendError) {
      throw new RelayError(err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Background relay
// ---------------------------------------------------------------------------

export function relayBackground(opts: BackgroundRelayOptions): { job: Job; promise: Promise<string> } {
  const manager = opts.jobManager ?? new JobManager();
  const job = manager.create({
    backend: opts.backend ?? DEFAULT_BACKEND,
    prompt: opts.prompt,
    repoPath: opts.repoPath,
    model: opts.model ?? undefined,
    sandbox: opts.sandbox,
  });

  manager.update(job.id, { status: 'running' });

  const promise = relay(opts)
    .then((result) => {
      manager.update(job.id, { status: 'completed', result });
      return result;
    })
    .catch((err) => {
      manager.update(job.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
      throw err;
    });

  return { job, promise };
}

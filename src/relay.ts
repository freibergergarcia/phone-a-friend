/**
 * Backend-agnostic relay helpers.
 *
 * Ported from phone_a_friend/relay.py
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BackendEvent } from './backends/index.js';
import {
  getBackend,
  isReviewScope,
  BackendError,
  type Backend,
  type ClaudePeerMessagingMode,
  type ReviewScope,
  type SandboxMode,
} from './backends/index.js';
import { JobManager, type Job } from './jobs.js';
import { SessionStore } from './sessions.js';
import {
  DEFAULT_REVIEW_REQUEST,
  VERDICT_SCHEMA_VERSION,
  VERDICT_SCHEMA_JSON,
  buildVerdictPrompt,
  serializeVerdict,
} from './verdict.js';

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
const EMPTY_GIT_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const GIT_DIFF_MAX_BUFFER_BYTES = MAX_DIFF_BYTES + 65_536;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * Translate a backend-layer error into a RelayError, preserving any
 * remediation guidance the backend attached. Without this, the CLI's
 * top-level catch sees only the bare message and the user loses the
 * context-aware fix (e.g. Claude's sandbox-blocked remediation when
 * called from inside Codex).
 */
function backendErrorToRelayError(err: BackendError): RelayError {
  const remediation = (err as { remediation?: unknown }).remediation;
  if (typeof remediation === 'string' && remediation.trim().length > 0) {
    return new RelayError(`${err.message}\n\n${remediation}`);
  }
  return new RelayError(err.message);
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

function isGitBufferOverflow(err: unknown): boolean {
  const execErr = err as NodeJS.ErrnoException;
  return execErr.code === 'ENOBUFS' || execErr.message?.includes('ENOBUFS') === true;
}

function gitDiffTooLargeError(): RelayError {
  return new RelayError(`Git diff is too large (exceeds max ${MAX_DIFF_BYTES} bytes)`);
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

function resolveGitWorktreeRoot(repoPath: string): string {
  try {
    const root = execFileSync(
      'git',
      ['-C', repoPath, 'rev-parse', '--show-toplevel'],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim();
    return root ? resolve(root) : repoPath;
  } catch {
    // Preserve the existing backend/git error path for non-repository directories.
    return repoPath;
  }
}

function workingTreeBase(repoPath: string): string {
  try {
    const head = execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return head ? 'HEAD' : EMPTY_GIT_TREE_SHA;
  } catch {
    return EMPTY_GIT_TREE_SHA;
  }
}

function tryGitDiff(repoPath: string, args: string[]): string {
  try {
    const result = execFileSync('git', ['-C', repoPath, 'diff', ...args], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
    });
    const diffText = result.trim();
    ensureSizeLimit('Git diff', diffText, MAX_DIFF_BYTES);
    return diffText;
  } catch (err: unknown) {
    if (err instanceof RelayError) throw err; // size limit — propagate
    if (isGitBufferOverflow(err)) throw gitDiffTooLargeError();
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
      maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
    });
    const diffText = result.trim();
    ensureSizeLimit('Git diff', diffText, MAX_DIFF_BYTES);
    return diffText;
  } catch (err: unknown) {
    if (err instanceof RelayError) throw err;
    if (isGitBufferOverflow(err)) throw gitDiffTooLargeError();
    const execErr = err as NodeJS.ErrnoException & {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    const detail = execErr.stderr?.toString().trim() || execErr.stdout?.toString().trim() || 'git diff failed';
    throw new RelayError(`Failed to collect git diff against ${base}: ${detail}`);
  }
}

function gitUntrackedDiff(repoPath: string): string {
  let untrackedOutput: string;
  try {
    untrackedOutput = execFileSync(
      'git',
      ['-C', repoPath, 'ls-files', '--others', '--exclude-standard', '-z'],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
      },
    );
  } catch (err: unknown) {
    if (isGitBufferOverflow(err)) throw gitDiffTooLargeError();
    const execErr = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const detail = execErr.stderr?.toString().trim() || 'git ls-files failed';
    throw new RelayError(`Failed to collect untracked files: ${detail}`);
  }

  const diffs: string[] = [];
  let diffBytes = 0;
  const appendDiff = (raw: string): void => {
    const output = raw.trim();
    if (!output) return;
    const nextBytes = diffBytes + (diffs.length > 0 ? 1 : 0) + sizeBytes(output);
    if (nextBytes > MAX_DIFF_BYTES) {
      throw new RelayError(
        `Git diff is too large (${nextBytes} bytes; max ${MAX_DIFF_BYTES} bytes)`,
      );
    }
    diffs.push(output);
    diffBytes = nextBytes;
  };
  for (const relativePath of untrackedOutput.split('\0').filter(Boolean)) {
    try {
      const output = execFileSync(
        'git',
        ['-C', repoPath, 'diff', '--no-index', '--', '/dev/null', relativePath],
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
        },
      );
      appendDiff(output);
    } catch (err: unknown) {
      const execErr = err as NodeJS.ErrnoException & {
        status?: number;
        stderr?: Buffer | string;
        stdout?: Buffer | string;
      };
      if (err instanceof RelayError) throw err;
      if (isGitBufferOverflow(err)) throw gitDiffTooLargeError();
      // `git diff --no-index` uses exit code 1 to report an ordinary diff.
      if (execErr.status === 1) {
        const output = execErr.stdout?.toString().trim() ?? '';
        appendDiff(output);
        continue;
      }
      const detail = execErr.stderr?.toString().trim() || 'git diff --no-index failed';
      throw new RelayError(`Failed to collect untracked diff for ${relativePath}: ${detail}`);
    }
  }

  return diffs.join('\n');
}

function gitDiffWorkingTree(repoPath: string): string {
  let tracked: string;
  try {
    tracked = execFileSync('git', ['-C', repoPath, 'diff', workingTreeBase(repoPath), '--'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
    }).trim();
  } catch (err: unknown) {
    if (isGitBufferOverflow(err)) throw gitDiffTooLargeError();
    const execErr = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const detail = execErr.stderr?.toString().trim() || 'git diff failed';
    throw new RelayError(`Failed to collect working-tree diff: ${detail}`);
  }

  const combined = [tracked, gitUntrackedDiff(repoPath)].filter(Boolean).join('\n');
  ensureSizeLimit('Git diff', combined, MAX_DIFF_BYTES);
  return combined;
}

function gitDiffAll(repoPath: string, base: string): string {
  if (workingTreeBase(repoPath) === EMPTY_GIT_TREE_SHA) {
    return gitDiffWorkingTree(repoPath);
  }

  let mergeBase: string;
  try {
    mergeBase = execFileSync('git', ['-C', repoPath, 'merge-base', base, 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: unknown) {
    const execErr = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const detail = execErr.stderr?.toString().trim() || 'git merge-base failed';
    throw new RelayError(`Failed to resolve merge base against ${base}: ${detail}`);
  }

  let tracked: string;
  try {
    tracked = execFileSync('git', ['-C', repoPath, 'diff', mergeBase, '--'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
    }).trim();
  } catch (err: unknown) {
    if (isGitBufferOverflow(err)) throw gitDiffTooLargeError();
    const execErr = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const detail = execErr.stderr?.toString().trim() || 'git diff failed';
    throw new RelayError(`Failed to collect all changes against ${base}: ${detail}`);
  }

  const combined = [tracked, gitUntrackedDiff(repoPath)].filter(Boolean).join('\n');
  ensureSizeLimit('Git diff', combined, MAX_DIFF_BYTES);
  return combined;
}

// ---------------------------------------------------------------------------
// Observer: scope capture, drift detection, progress forwarding
// ---------------------------------------------------------------------------

export interface RelayScopeInfo {
  scope: ReviewScope;
  base: string;
  /** sha256 of the collected diff text. */
  diffHash: string;
  diffBytes: number;
  diffFiles: number;
}

export interface RelayDriftInfo {
  /** true: the diff changed during the review; false: unchanged; null: could not re-collect. */
  drifted: boolean | null;
  diffHash: string | null;
}

/**
 * Optional hooks for callers that record delegated work (task tracking).
 * Every hook is best-effort: observer errors never break a relay, and no
 * hook is invoked unless the caller supplied it.
 */
export interface RelayObserver {
  onScope?(info: RelayScopeInfo): void;
  onDrift?(info: RelayDriftInfo): void;
  onEvent?(event: BackendEvent): void;
  onSessionLinked?(backendSessionId: string): void;
}

/** Fan every hook out to each listening observer. Undefined when nobody listens. */
export function mergeObservers(...observers: Array<RelayObserver | undefined>): RelayObserver | undefined {
  const active = observers.filter((o): o is RelayObserver => Boolean(o));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  const merged: RelayObserver = {};
  const fanOut = <K extends keyof RelayObserver>(hook: K): void => {
    const targets = active.filter((o) => typeof o[hook] === 'function');
    if (targets.length === 0) return;
    merged[hook] = ((arg: never) => {
      for (const target of targets) {
        safeObserve(() => (target[hook] as (value: never) => void)(arg));
      }
    }) as RelayObserver[K];
  };
  fanOut('onScope');
  fanOut('onDrift');
  fanOut('onEvent');
  fanOut('onSessionLinked');
  return merged;
}

function safeObserve(fn: () => void): void {
  try {
    fn();
  } catch {
    // Observers must never break the relay.
  }
}

function hashDiff(diffText: string): string {
  return createHash('sha256').update(diffText, 'utf8').digest('hex');
}

function describeDiff(diffText: string, scope: ReviewScope, base: string): RelayScopeInfo {
  const diffFiles = (diffText.match(/^diff --git /gm) ?? []).length;
  return {
    scope,
    base,
    diffHash: hashDiff(diffText),
    diffBytes: sizeBytes(diffText),
    diffFiles,
  };
}

interface ObserverBridge {
  onEvent: ((event: BackendEvent) => void) | undefined;
  sessionLinked: (backendSessionId: string) => void;
}

/**
 * Turn an observer into backend-facing callbacks. A session may be reported
 * twice (onSessionCreated plus a session_linked event); the bridge forwards
 * each id once.
 */
function observerBridge(observer?: RelayObserver): ObserverBridge {
  const linked = new Set<string>();
  const sessionLinked = (backendSessionId: string): void => {
    if (!backendSessionId || linked.has(backendSessionId)) return;
    linked.add(backendSessionId);
    safeObserve(() => observer?.onSessionLinked?.(backendSessionId));
  };
  const wantsEvents = Boolean(observer && (observer.onEvent || observer.onSessionLinked));
  const onEvent = wantsEvents
    ? (event: BackendEvent): void => {
        if (event.type === 'session_linked') {
          const id = event.data?.backendSessionId;
          if (typeof id === 'string') sessionLinked(id);
        }
        safeObserve(() => observer?.onEvent?.(event));
      }
    : undefined;
  return { onEvent, sessionLinked };
}

/**
 * Re-collect the review diff after the backend finished and tell the observer
 * whether the reviewed snapshot still matches the working tree. A backend with
 * local file access reads the live tree, so a changed diff means the result
 * may not cover what is on disk now.
 */
function reportReviewDrift(
  observer: RelayObserver | undefined,
  repoPath: string,
  base: string,
  scope: ReviewScope,
  originalHash: string,
): void {
  if (!observer?.onDrift) return;
  let info: RelayDriftInfo;
  try {
    const current = hashDiff(collectReviewDiff(repoPath, base, scope));
    info = { drifted: current !== originalHash, diffHash: current };
  } catch (err) {
    const tooLarge = err instanceof RelayError && /too large/i.test(err.message);
    info = { drifted: tooLarge ? true : null, diffHash: null };
  }
  safeObserve(() => observer.onDrift?.(info));
}

function collectReviewDiff(repoPath: string, base: string, scope: ReviewScope): string {
  if (scope === 'branch') return gitDiffBase(repoPath, base);
  if (scope === 'working-tree') return gitDiffWorkingTree(repoPath);
  return gitDiffAll(repoPath, base);
}

function defaultReviewRequest(scope: ReviewScope): string {
  if (scope === 'working-tree') {
    return 'Review the staged, unstaged, and untracked working-tree changes. Flag correctness, security, regression, and quality concerns; ignore style preferences unless they obscure intent.';
  }
  if (scope === 'all') {
    return 'Review the committed branch changes plus staged, unstaged, and untracked working-tree changes. Flag correctness, security, regression, and quality concerns; ignore style preferences unless they obscure intent.';
  }
  return DEFAULT_REVIEW_REQUEST;
}

function noChangesReviewResponse(scope: ReviewScope, verdictJson: boolean): string {
  const summary = `No changes found for review scope "${scope}".`;
  if (!verdictJson) return summary;
  return serializeVerdict({
    schema_version: VERDICT_SCHEMA_VERSION,
    verdict: 'abstain',
    summary,
    findings: [],
  });
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
  scope?: ReviewScope;
  prompt?: string;
  timeoutSeconds?: number;
  model?: string | null;
  sandbox?: SandboxMode;
  schema?: string | null;
  fast?: boolean;
  /** Claude-only cross-session messaging behavior. */
  peerMessaging?: ClaudePeerMessagingMode;
  /**
   * Request a verdict JSON envelope (see src/verdict.ts). When true, the
   * caller's prompt is replaced with the canonical verdict prompt, the
   * schema is replaced with VERDICT_SCHEMA_JSON, and the native review()
   * path is bypassed so schema enforcement is consistent across backends.
   * The raw response should be passed to parseVerdict() by the caller.
   */
  verdictJson?: boolean;
  /** Scope, drift, and progress hooks used by task tracking. */
  observer?: RelayObserver;
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
  /** Claude-only cross-session messaging behavior. */
  peerMessaging?: ClaudePeerMessagingMode;
  sessionStore?: SessionStore;
  /** Scope, drift, and progress hooks used by task tracking. */
  observer?: RelayObserver;
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
  peerMessaging: ClaudePeerMessagingMode;
  sessionStore?: SessionStore;
  observer?: RelayObserver;
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
    peerMessaging = 'native',
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
    peerMessaging,
    sessionStore: opts.sessionStore,
    observer: opts.observer,
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
    peerMessaging,
    sessionStore,
    observer,
  } = prepareRelay(opts);
  const bridge = observerBridge(observer);

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
        peerMessaging,
        sessionLabel: session,
        sessionHistory: existing?.history ?? [],
        onSessionCreated: (newSessionId) => {
          createdSessionId = newSessionId;
          bridge.sessionLinked(newSessionId);
        },
        onEvent: bridge.onEvent,
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
      peerMessaging,
      sessionLabel: session,
      sessionHistory: storedSession?.history ?? [],
      onSessionCreated: (newSessionId) => {
        createdSessionId = newSessionId;
        bridge.sessionLinked(newSessionId);
      },
      onEvent: bridge.onEvent,
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
      throw backendErrorToRelayError(err);
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
    peerMessaging,
    sessionStore,
    observer,
  } = prepareRelay(opts);
  const bridge = observerBridge(observer);

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
    peerMessaging,
    sessionLabel: session,
    sessionId: backendSession ?? storedSession?.backendSessionId ?? null,
    persistSession: Boolean(session),
    resumeSession: Boolean(backendSession || (session && storedSession)),
    sessionHistory: storedSession?.history ?? [],
    onSessionCreated: observer ? bridge.sessionLinked : undefined,
    onEvent: bridge.onEvent,
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
      throw backendErrorToRelayError(err);
    }
    throw err;
  }
}

export async function reviewRelay(opts: ReviewRelayOptions): Promise<string> {
  const scope = opts.scope ?? 'branch';
  if (!isReviewScope(scope)) {
    throw new RelayError(`Invalid review scope: ${String(scope)}`);
  }

  const verdictJson = Boolean(opts.verdictJson);
  // For verdict mode, compose the caller's review request with the envelope
  // instructions instead of replacing the request outright. The caller's
  // intent (e.g. "focus on the auth module") must survive structured output.
  const effectivePrompt = verdictJson
    ? buildVerdictPrompt(opts.prompt?.trim() ? opts.prompt : defaultReviewRequest(scope))
    : opts.prompt;
  const effectiveSchema = verdictJson ? VERDICT_SCHEMA_JSON : (opts.schema ?? null);

  const {
    repoPath,
    backend = DEFAULT_BACKEND,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    model = null,
    sandbox = DEFAULT_SANDBOX,
    fast = false,
    peerMessaging = 'native',
  } = opts;
  const prompt = effectivePrompt;
  const schema = effectiveSchema;

  if (timeoutSeconds <= 0) {
    throw new RelayError('Timeout must be greater than zero');
  }

  const requestedRepo = resolve(repoPath);
  if (!existsSync(requestedRepo) || !statSync(requestedRepo).isDirectory()) {
    throw new RelayError(
      `Repository path does not exist or is not a directory: ${requestedRepo}`,
    );
  }
  const resolvedRepo = resolveGitWorktreeRoot(requestedRepo);

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

  // Resolve and bound the selected scope before any backend call. This keeps
  // empty-scope and size-limit behavior deterministic even when a backend has
  // native review support. Generic reviews reuse the already-collected diff.
  const collectedDiff = collectReviewDiff(resolvedRepo, base, scope);
  if (!collectedDiff) return noChangesReviewResponse(scope, verdictJson);

  const observer = opts.observer;
  const bridge = observerBridge(observer);
  const scopeInfo = describeDiff(collectedDiff, scope, base);
  safeObserve(() => observer?.onScope?.(scopeInfo));

  // If backend supports review(), use it directly.
  // Skip native review when:
  //   - the backend does not declare support for the selected review scope;
  //   - a custom prompt is provided — Codex exec review cannot combine
  //     --base with a positional prompt, so the generic run() path (which
  //     includes the prompt alongside the diff) gives better results.
  //   - a schema is set — native review() does not forward schema to the
  //     backend's structured output enforcement, so the schema would be
  //     silently dropped. Use the generic run() path which honors schema.
  const nativeReviewScopes = selectedBackend.nativeReviewScopes ?? new Set<ReviewScope>(['branch']);
  if (
    typeof selectedBackend.review === 'function'
    && nativeReviewScopes.has(scope)
    && !prompt
    && !schema
  ) {
    try {
      const nativeResult = await selectedBackend.review({
        repoPath: resolvedRepo,
        timeoutSeconds,
        sandbox,
        model,
        env,
        base,
        scope,
        prompt,
        onEvent: bridge.onEvent,
      });
      reportReviewDrift(observer, resolvedRepo, base, scope, scopeInfo.diffHash);
      return nativeResult;
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
  const diffText = collectedDiff;
  const reviewPrompt = prompt ?? defaultReviewRequest(scope);
  const fullPrompt = buildPrompt({
    prompt: reviewPrompt,
    repoPath: resolvedRepo,
    contextText: '',
    diffText,
    localFileAccess: selectedBackend.localFileAccess,
  });
  ensureSizeLimit('Relay prompt', fullPrompt, MAX_PROMPT_BYTES);

  try {
    const result = await selectedBackend.run({
      prompt: fullPrompt,
      repoPath: resolvedRepo,
      timeoutSeconds,
      sandbox,
      model,
      env,
      schema,
      fast,
      peerMessaging,
      sessionLabel: 'review',
      onEvent: bridge.onEvent,
    });
    reportReviewDrift(observer, resolvedRepo, base, scope, scopeInfo.diffHash);
    return result;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof BackendError) {
      throw backendErrorToRelayError(err);
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

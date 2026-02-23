/**
 * Backend-agnostic relay helpers.
 *
 * Ported from phone_a_friend/relay.py
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getBackend, BackendError, type SandboxMode } from './backends/index.js';

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

function gitDiff(repoPath: string): string {
  try {
    const result = execFileSync('git', ['-C', repoPath, 'diff', '--'], {
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
    throw new RelayError(`Failed to collect git diff: ${detail}`);
  }
}

function buildPrompt(opts: {
  prompt: string;
  repoPath: string;
  contextText: string;
  diffText: string;
}): string {
  const sections = [
    'You are helping another coding agent by reviewing or advising on work in a local repository.',
    `Repository path: ${opts.repoPath}`,
    'Use the repository files for context when needed.',
    'Respond with concise, actionable feedback.',
    '',
    'Request:',
    opts.prompt.trim(),
  ];

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
}

export async function relay(opts: RelayOptions): Promise<string> {
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

  const resolvedContext = resolveContextText(contextFile, contextText);
  const diffText = includeDiff ? gitDiff(resolvedRepo) : '';
  const fullPrompt = buildPrompt({
    prompt,
    repoPath: resolvedRepo,
    contextText: resolvedContext,
    diffText,
  });
  ensureSizeLimit('Relay prompt', fullPrompt, MAX_PROMPT_BYTES);

  const env = nextRelayEnv();

  try {
    return await selectedBackend.run({
      prompt: fullPrompt,
      repoPath: resolvedRepo,
      timeoutSeconds,
      sandbox,
      model,
      env,
    });
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof BackendError) {
      throw new RelayError(err.message);
    }
    throw err;
  }
}

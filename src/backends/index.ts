/**
 * Backend interface and registry for relay targets.
 *
 * Ported from phone_a_friend/backends/__init__.py
 */

import { execFileSync, spawn as nodeSpawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface BackendResult {
  output: string;
  exitCode: number;
}

export interface ReviewOptions {
  repoPath: string;
  timeoutSeconds: number;
  sandbox: SandboxMode;
  model: string | null;
  env: Record<string, string>;
  base: string;
  prompt?: string;
}

export interface Backend {
  name: string;
  localFileAccess: boolean;
  allowedSandboxes: ReadonlySet<SandboxMode>;
  run(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): Promise<string>;
  review?(opts: ReviewOptions): Promise<string>;
  runStream?(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): AsyncIterable<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendError';
  }
}

// ---------------------------------------------------------------------------
// Install hints
// ---------------------------------------------------------------------------

export const INSTALL_HINTS: Record<string, string> = {
  codex: 'npm install -g @openai/codex',
  gemini: 'npm install -g @google/gemini-cli',
  ollama: 'https://ollama.com/download',
  claude: 'npm install -g @anthropic-ai/claude-code',
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, Backend>();

export function registerBackend(backend: Backend): void {
  registry.set(backend.name, backend);
}

export function getBackend(name: string): Backend {
  const backend = registry.get(name);
  if (!backend) {
    const supported = [...registry.keys()].sort().join(', ');
    throw new BackendError(
      `Unsupported relay backend: ${name}. Supported: ${supported}`,
    );
  }
  return backend;
}

/** Clear registry — only for testing. */
export function _resetRegistry(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// PATH detection
// ---------------------------------------------------------------------------

export function isInPath(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function checkBackends(
  whichFn: (name: string) => boolean = isInPath,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const name of Object.keys(INSTALL_HINTS).sort()) {
    result[name] = whichFn(name);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Async subprocess runner
// ---------------------------------------------------------------------------

export interface SpawnCliOptions {
  timeoutMs: number;
  /** Full process environment. Defaults to process.env if not provided.
   *  When provided, this replaces the entire env (Node.js spawn behavior).
   *  Callers must pass a complete env (e.g. from nextRelayEnv()), not partial overrides. */
  env?: Record<string, string>;
  cwd?: string;
  /** Label used in error messages (e.g. "codex exec", "gemini"). Defaults to the command name. */
  label?: string;
}

export interface SpawnCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Async subprocess runner shared by all CLI backends.
 * Replaces execFileSync: non-blocking, timeout handling, signal forwarding, stderr draining.
 */
export function spawnCli(
  command: string,
  args: string[],
  opts: SpawnCliOptions,
): Promise<SpawnCliResult> {
  const label = opts.label ?? command;

  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env as Record<string, string>,
      cwd: opts.cwd,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, opts.timeoutMs);

    const onSigint = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', onSigint);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      reject(new BackendError(`${label} failed to start: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);

      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString().trim();

      if (timedOut) {
        reject(new BackendError(`${label} timed out after ${opts.timeoutMs / 1000}s`));
        return;
      }

      if (signal) {
        reject(new BackendError(`${label} killed by signal ${signal}`));
        return;
      }

      if (code !== 0 && code !== null) {
        const detail = stderr || stdout || `${label} exited with code ${code}`;
        reject(new BackendError(detail));
        return;
      }

      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

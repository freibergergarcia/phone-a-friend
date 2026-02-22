/**
 * Backend interface and registry for relay targets.
 *
 * Ported from phone_a_friend/backends/__init__.py
 */

import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface BackendResult {
  output: string;
  exitCode: number;
}

export interface Backend {
  name: string;
  allowedSandboxes: ReadonlySet<SandboxMode>;
  run(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): string;
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

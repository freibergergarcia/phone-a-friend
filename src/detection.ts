/**
 * Backend detection system.
 *
 * Used by setup, doctor, and relay to scan the environment for available
 * backends: CLI (codex/gemini), Local (ollama), plus host integrations (claude).
 */

import { execFileSync } from 'node:child_process';
import { isInPath } from './backends/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackendStatus {
  name: string;
  category: 'cli' | 'local' | 'host';
  available: boolean;
  detail: string;
  installHint: string;
  models?: string[];
  /** Per-model capabilities from Ollama /api/show (e.g., "tools", "vision", "thinking"). */
  modelCapabilities?: Record<string, string[]>;
  planned?: boolean;
}

export interface EnvironmentStatus {
  tmux: { active: boolean; installed: boolean };
  agentTeams: { enabled: boolean };
}

export interface DetectionReport {
  cli: BackendStatus[];
  local: BackendStatus[];
  host: BackendStatus[];
  environment: EnvironmentStatus;
}

// ---------------------------------------------------------------------------
// Install hints
// ---------------------------------------------------------------------------

const CLI_BACKENDS: { name: string; installHint: string; label: string }[] = [
  { name: 'codex', installHint: 'npm install -g @openai/codex', label: 'OpenAI Codex CLI' },
  { name: 'gemini', installHint: 'npm install -g @google/gemini-cli', label: 'Google Gemini CLI' },
  { name: 'opencode', installHint: 'curl -fsSL https://opencode.ai/install | bash', label: 'OpenCode CLI' },
];

const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';
const OLLAMA_INSTALL_HINT = 'brew install ollama  # or: curl -fsSL https://ollama.com/install.sh | sh';

const HOST_INTEGRATIONS: { name: string; installHint: string; label: string }[] = [
  { name: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code', label: 'Claude Code CLI' },
];

// ---------------------------------------------------------------------------
// Type for injectable functions (testability)
// ---------------------------------------------------------------------------

type WhichFn = (name: string) => boolean;
type FetchFn = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

// ---------------------------------------------------------------------------
// CLI backend detection
// ---------------------------------------------------------------------------

export async function detectCliBackends(
  whichFn: WhichFn = isInPath,
): Promise<BackendStatus[]> {
  return CLI_BACKENDS.map(({ name, installHint, label }) => {
    const found = whichFn(name);
    return {
      name,
      category: 'cli' as const,
      available: found,
      detail: found ? `${label} (found in PATH)` : 'not found in PATH',
      installHint,
    };
  });
}

// ---------------------------------------------------------------------------
// Local backend detection (Ollama)
// ---------------------------------------------------------------------------

export async function detectLocalBackends(
  whichFn: WhichFn = isInPath,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<BackendStatus[]> {
  const binaryInstalled = whichFn('ollama');
  const host = process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST;

  let serverResponding = false;
  let models: string[] = [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetchFn(`${host}/api/tags`, { signal: controller.signal });
    if (resp.ok) {
      serverResponding = true;
      const data = (await resp.json()) as { models?: { name: string }[] };
      models = (data.models ?? []).map(m => m.name);
    }
  } catch {
    // Server not reachable or timed out
  } finally {
    clearTimeout(timeout);
  }

  let available = false;
  let detail: string;
  let installHint: string;

  if (serverResponding && models.length > 0) {
    available = true;
    detail = `${host} (${models.length} model${models.length !== 1 ? 's' : ''})`;
    installHint = '';
  } else if (serverResponding && models.length === 0) {
    detail = `${host} — no models pulled`;
    installHint = 'ollama pull qwen3';
  } else if (binaryInstalled && !serverResponding) {
    detail = 'installed but not running';
    installHint = 'ollama serve';
  } else {
    detail = 'not installed';
    installHint = OLLAMA_INSTALL_HINT;
  }

  // Probe per-model capabilities via /api/show (parallel, best-effort)
  let modelCapabilities: Record<string, string[]> | undefined;
  if (serverResponding && models.length > 0) {
    modelCapabilities = {};
    const caps = await Promise.all(
      models.map(async (name): Promise<[string, string[]]> => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        try {
          const resp = await fetchFn(`${host}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
            signal: ctrl.signal,
          } as RequestInit);
          if (resp.ok) {
            const data = (await resp.json()) as { capabilities?: string[] };
            return [name, data.capabilities ?? []];
          }
        } catch {
          // Best-effort — skip on failure
        } finally {
          clearTimeout(t);
        }
        return [name, []];
      }),
    );
    for (const [name, c] of caps) {
      modelCapabilities[name] = c;
    }
  }

  return [{
    name: 'ollama',
    category: 'local' as const,
    available,
    detail,
    installHint,
    models: serverResponding ? models : undefined,
    modelCapabilities,
  }];
}

// ---------------------------------------------------------------------------
// Host integration detection
// ---------------------------------------------------------------------------

export async function detectHostIntegrations(
  whichFn: WhichFn = isInPath,
): Promise<BackendStatus[]> {
  return HOST_INTEGRATIONS.map(({ name, installHint, label }) => {
    const found = whichFn(name);
    return {
      name,
      category: 'host' as const,
      available: found,
      detail: found ? `${label} (found in PATH)` : 'not found in PATH',
      installHint,
    };
  });
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export function detectEnvironment(
  whichFn: WhichFn = isInPath,
): EnvironmentStatus {
  return {
    tmux: {
      active: !!process.env.TMUX,
      installed: whichFn('tmux'),
    },
    agentTeams: {
      enabled: process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1',
    },
  };
}

// ---------------------------------------------------------------------------
// OpenCode model discovery (called by consumers, not by detectAll)
// ---------------------------------------------------------------------------

/**
 * Discover models available to OpenCode via `opencode models`.
 * Returns fully qualified names (e.g., "ollama/qwen3-coder", "opencode/gpt-5-nano").
 * Best-effort: returns empty array if the command fails.
 */
function discoverOpenCodeModels(whichFn: WhichFn = isInPath): string[] {
  if (!whichFn('opencode')) return [];
  try {
    const output = execFileSync('opencode', ['models'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    }).toString().trim();
    if (!output) return [];
    return output.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Populate the OpenCode CLI backend entry with models from `opencode models`
 * and tool-calling capabilities for Ollama models. Call after detectAll().
 *
 * This is separate from detectAll() to keep detection pure (no subprocess
 * calls, no config I/O). Consumers (TUI hook, doctor) call this as a
 * post-processing step.
 */
export function decorateOpenCodeModels(
  report: DetectionReport,
  whichFn: WhichFn = isInPath,
): void {
  const opencode = report.cli.find(b => b.name === 'opencode' && b.available);
  if (!opencode) return;

  const models = discoverOpenCodeModels(whichFn);
  if (models.length === 0) return;
  opencode.models = models;

  // For ollama-prefixed models, copy capabilities from the Ollama detection.
  // OpenCode strips `:latest` tags (e.g., "qwen3-coder") while Ollama keeps
  // them (e.g., "qwen3-coder:latest"), so try both variants.
  const ollama = report.local.find(b => b.name === 'ollama');
  if (ollama?.modelCapabilities) {
    const caps: Record<string, string[]> = {};
    for (const model of models) {
      if (model.startsWith('ollama/')) {
        const ollamaName = model.slice('ollama/'.length);
        const ollamaCaps =
          ollama.modelCapabilities[ollamaName] ??
          ollama.modelCapabilities[`${ollamaName}:latest`];
        if (ollamaCaps) {
          caps[model] = ollamaCaps;
        }
      }
    }
    if (Object.keys(caps).length > 0) {
      opencode.modelCapabilities = caps;
    }
  }
}

// ---------------------------------------------------------------------------
// Full detection
// ---------------------------------------------------------------------------

export async function detectAll(
  whichFn: WhichFn = isInPath,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<DetectionReport> {
  const [cli, local, host] = await Promise.all([
    detectCliBackends(whichFn),
    detectLocalBackends(whichFn, fetchFn),
    detectHostIntegrations(whichFn),
  ]);

  const environment = detectEnvironment(whichFn);

  return { cli, local, host, environment };
}

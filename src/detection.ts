/**
 * Three-category backend detection system.
 *
 * Used by setup, doctor, and relay to scan the environment for available
 * backends: CLI (codex/gemini), Local (ollama), API (openai/anthropic/google),
 * plus host integrations (claude).
 */

import { isInPath } from './backends/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackendStatus {
  name: string;
  category: 'cli' | 'local' | 'api' | 'host';
  available: boolean;
  detail: string;
  installHint: string;
  models?: string[];
  planned?: boolean;
}

export interface DetectionReport {
  cli: BackendStatus[];
  local: BackendStatus[];
  api: BackendStatus[];
  host: BackendStatus[];
}

// ---------------------------------------------------------------------------
// Install hints
// ---------------------------------------------------------------------------

const CLI_BACKENDS: { name: string; installHint: string; label: string }[] = [
  { name: 'codex', installHint: 'npm install -g @openai/codex', label: 'OpenAI Codex CLI' },
  { name: 'gemini', installHint: 'npm install -g @google/gemini-cli', label: 'Google Gemini CLI' },
];

const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';
const OLLAMA_INSTALL_HINT = 'brew install ollama  # or: curl -fsSL https://ollama.com/install.sh | sh';

const API_BACKENDS: { name: string; envVar: string; installHint: string; planned: boolean }[] = [
  { name: 'openai', envVar: 'OPENAI_API_KEY', installHint: 'export OPENAI_API_KEY=sk-...', planned: false },
  { name: 'anthropic', envVar: 'ANTHROPIC_API_KEY', installHint: 'export ANTHROPIC_API_KEY=sk-ant-...', planned: true },
  { name: 'google', envVar: 'GOOGLE_API_KEY', installHint: 'export GOOGLE_API_KEY=...', planned: true },
];

const HOST_INTEGRATIONS: { name: string; installHint: string; label: string }[] = [
  { name: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code', label: 'Claude Code CLI' },
];

// ---------------------------------------------------------------------------
// Type for injectable functions (testability)
// ---------------------------------------------------------------------------

type WhichFn = (name: string) => boolean;
type FetchFn = (url: string, signal?: AbortSignal) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

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
  fetchFn: FetchFn = globalThis.fetch as unknown as FetchFn,
): Promise<BackendStatus[]> {
  const binaryInstalled = whichFn('ollama');
  const host = process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST;

  let serverResponding = false;
  let models: string[] = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetchFn(`${host}/api/tags`, controller.signal);
    clearTimeout(timeout);
    if (resp.ok) {
      serverResponding = true;
      const data = (await resp.json()) as { models?: { name: string }[] };
      models = (data.models ?? []).map(m => m.name);
    }
  } catch {
    // Server not reachable or timed out
  }

  let available = false;
  let detail: string;
  let installHint: string;

  if (binaryInstalled && serverResponding && models.length > 0) {
    available = true;
    detail = `${host} (${models.length} model${models.length !== 1 ? 's' : ''})`;
    installHint = '';
  } else if (binaryInstalled && serverResponding && models.length === 0) {
    detail = `${host} — no models pulled`;
    installHint = 'ollama pull qwen3';
  } else if (binaryInstalled && !serverResponding) {
    detail = 'installed but not running';
    installHint = 'ollama serve';
  } else {
    detail = 'not installed';
    installHint = OLLAMA_INSTALL_HINT;
  }

  return [{
    name: 'ollama',
    category: 'local' as const,
    available,
    detail,
    installHint,
    models: models.length > 0 ? models : undefined,
  }];
}

// ---------------------------------------------------------------------------
// API backend detection
// ---------------------------------------------------------------------------

export function detectApiBackends(): BackendStatus[] {
  return API_BACKENDS.map(({ name, envVar, installHint, planned }) => {
    const keySet = !!process.env[envVar];
    return {
      name,
      category: 'api' as const,
      available: keySet && !planned,
      detail: keySet ? `${envVar} set` : `${envVar} not set`,
      installHint,
      planned,
    };
  });
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
// Full detection
// ---------------------------------------------------------------------------

export async function detectAll(
  whichFn: WhichFn = isInPath,
  fetchFn: FetchFn = globalThis.fetch as unknown as FetchFn,
): Promise<DetectionReport> {
  const [cli, local, host] = await Promise.all([
    detectCliBackends(whichFn),
    detectLocalBackends(whichFn, fetchFn),
    detectHostIntegrations(whichFn),
  ]);
  const api = detectApiBackends();

  return { cli, local, api, host };
}

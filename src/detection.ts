/**
 * Backend detection system.
 *
 * Used by setup, doctor, and relay to scan the environment for available
 * backends: CLI (codex/gemini), Local (ollama), plus host integrations (claude).
 */

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
  planned?: boolean;
}

export interface DetectionReport {
  cli: BackendStatus[];
  local: BackendStatus[];
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

const HOST_INTEGRATIONS: { name: string; installHint: string; label: string }[] = [
  { name: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code', label: 'Claude Code CLI' },
];

// ---------------------------------------------------------------------------
// Type for injectable functions (testability)
// ---------------------------------------------------------------------------

type WhichFn = (name: string) => boolean;
type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

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
  fetchFn: FetchFn = globalThis.fetch,
): Promise<DetectionReport> {
  const [cli, local, host] = await Promise.all([
    detectCliBackends(whichFn),
    detectLocalBackends(whichFn, fetchFn),
    detectHostIntegrations(whichFn),
  ]);

  return { cli, local, host };
}

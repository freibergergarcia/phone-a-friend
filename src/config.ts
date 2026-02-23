/**
 * TOML configuration system with two-layer merge (user + repo).
 *
 * Config files:
 *   User:  $XDG_CONFIG_HOME/phone-a-friend/config.toml  (or ~/.config/...)
 *   Repo:  <repoRoot>/.phone-a-friend.toml
 *
 * Precedence: CLI flags > env vars > repo config > user config > defaults
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as tomlParse, stringify as tomlStringify } from 'smol-toml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackendConfig {
  model?: string;
  host?: string;

  [key: string]: unknown;
}

export interface PafConfig {
  defaults: {
    backend: string;
    sandbox: string;
    timeout: number;
    include_diff: boolean;
    review_base?: string;
  };
  backends?: Record<string, BackendConfig>;
  [key: string]: unknown;
}

export interface ResolvedConfig {
  backend: string;
  sandbox: string;
  timeout: number;
  includeDiff: boolean;
  model?: string;
  reviewBase?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: PafConfig = {
  defaults: {
    backend: 'codex',
    sandbox: 'read-only',
    timeout: 600,
    include_diff: false,
  },
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function configPaths(
  repoRoot?: string,
  xdgConfigHome?: string,
  homeDir?: string,
): { user: string; repo: string | null } {
  const configBase = xdgConfigHome
    ?? process.env.XDG_CONFIG_HOME
    ?? join(homeDir ?? homedir(), '.config');

  return {
    user: join(configBase, 'phone-a-friend', 'config.toml'),
    repo: repoRoot ? join(repoRoot, '.phone-a-friend.toml') : null,
  };
}

// ---------------------------------------------------------------------------
// Deep merge helper
// ---------------------------------------------------------------------------

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function loadConfigFromFile(filePath: string): PafConfig {
  if (!existsSync(filePath)) {
    return { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = tomlParse(content) as Record<string, unknown>;
    // Merge parsed over defaults
    const merged = deepMerge(
      { defaults: { ...DEFAULT_CONFIG.defaults } } as Record<string, unknown>,
      parsed,
    );
    return merged as unknown as PafConfig;
  } catch {
    return { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };
  }
}

export function loadConfig(
  repoRoot?: string,
  xdgConfigHome?: string,
  homeDir?: string,
): PafConfig {
  const paths = configPaths(repoRoot, xdgConfigHome, homeDir);

  // Start with defaults
  let config: PafConfig = { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };

  // Layer 1: user config
  config = loadConfigFromFile(paths.user) as PafConfig;

  // Layer 2: repo config (merges over user)
  if (paths.repo && existsSync(paths.repo)) {
    const repoConfig = tomlParse(readFileSync(paths.repo, 'utf-8')) as Record<string, unknown>;
    config = deepMerge(config as unknown as Record<string, unknown>, repoConfig) as unknown as PafConfig;
  }

  return config;
}

export function saveConfig(cfg: Partial<PafConfig>, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const content = tomlStringify(cfg as Record<string, unknown>);
  writeFileSync(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function configInit(filePath: string, force = false): void {
  if (!force && existsSync(filePath)) {
    throw new Error(`Config already exists at ${filePath}. Use --force to overwrite.`);
  }
  saveConfig(DEFAULT_CONFIG, filePath);
}

// ---------------------------------------------------------------------------
// Get / Set with dot notation
// ---------------------------------------------------------------------------

export function configGet(key: string, cfg: unknown): unknown {
  const parts = key.split('.');
  let current: unknown = cfg;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function configSet(key: string, rawValue: string, filePath: string): void {
  // Strict load — fail on malformed TOML rather than silently using defaults
  let cfg: Record<string, unknown>;
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    cfg = tomlParse(content) as Record<string, unknown>; // throws on malformed TOML
  } else {
    cfg = { defaults: { ...DEFAULT_CONFIG.defaults } };
  }

  // Type inference
  let value: unknown;
  if (rawValue.toLowerCase() === 'true') {
    value = true;
  } else if (rawValue.toLowerCase() === 'false') {
    value = false;
  } else if (/^\d+$/.test(rawValue)) {
    value = Number(rawValue);
  } else {
    value = rawValue;
  }

  // Set via dot notation
  const parts = key.split('.');
  let current: Record<string, unknown> = cfg;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;

  saveConfig(cfg as Partial<PafConfig>, filePath);
}

// ---------------------------------------------------------------------------
// Resolve — full precedence merge
// ---------------------------------------------------------------------------

export function resolveConfig(
  cliOpts: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env,
  repoRoot?: string,
  xdgConfigHome?: string,
): ResolvedConfig {
  const cfg = loadConfig(repoRoot, xdgConfigHome);

  const backend =
    cliOpts.to ??
    env.PHONE_A_FRIEND_BACKEND ??
    cfg.defaults.backend;

  const sandbox =
    cliOpts.sandbox ??
    env.PHONE_A_FRIEND_SANDBOX ??
    cfg.defaults.sandbox;

  const timeoutRaw =
    cliOpts.timeout ??
    env.PHONE_A_FRIEND_TIMEOUT ??
    String(cfg.defaults.timeout);
  const timeout = /^\d+$/.test(timeoutRaw) ? Number(timeoutRaw) : cfg.defaults.timeout;

  const includeDiffRaw =
    cliOpts.includeDiff ??
    env.PHONE_A_FRIEND_INCLUDE_DIFF;
  const includeDiff = includeDiffRaw !== undefined
    ? includeDiffRaw === 'true' || includeDiffRaw === '1'
    : cfg.defaults.include_diff;

  const model = cliOpts.model ?? cfg.backends?.[backend]?.model ?? undefined;

  const reviewBase =
    cliOpts.base ??
    env.PHONE_A_FRIEND_REVIEW_BASE ??
    cfg.defaults.review_base ??
    undefined;

  return { backend, sandbox, timeout, includeDiff, model, reviewBase };
}

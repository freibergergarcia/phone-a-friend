/**
 * Pinned invariants for the Codex plugin + subagent artifacts.
 *
 * Codex reads `.agents/plugins/marketplace.json` to discover the marketplace
 * and `plugins/phone-a-friend/.codex-plugin/plugin.json` for the per-plugin
 * manifest. Subagent personas at `agents/codex/paf-*.toml` are loaded by
 * Codex with a strict TOML parser and required-field validation. These tests
 * pin the contract so a manifest regression is caught locally before it
 * surfaces as "No plugins found in marketplace" or a silent agent skip in
 * Codex.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

const REPO = join(__dirname, '..');

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(REPO, rel), 'utf-8'));
}

function readToml(rel: string): unknown {
  return parseToml(readFileSync(join(REPO, rel), 'utf-8'));
}

const packageVersion = (readJson('package.json') as { version: string }).version;

describe('Codex per-plugin manifest (.codex-plugin/plugin.json at repo root)', () => {
  const file = '.codex-plugin/plugin.json';

  it('exists', () => {
    expect(existsSync(join(REPO, file))).toBe(true);
  });

  it('parses as valid JSON', () => {
    expect(() => readJson(file)).not.toThrow();
  });

  it('declares the required fields name, version, description', () => {
    const manifest = readJson(file) as Record<string, unknown>;
    expect(manifest.name).toBe('phone-a-friend');
    expect(typeof manifest.version).toBe('string');
    expect(typeof manifest.description).toBe('string');
    expect((manifest.description as string).length).toBeGreaterThan(0);
  });

  it('declares version matching package.json (CI-blocking invariant)', () => {
    const manifest = readJson(file) as { version: string };
    expect(manifest.version).toBe(packageVersion);
  });
});

describe('Codex per-plugin manifest (plugins/phone-a-friend/.codex-plugin/plugin.json)', () => {
  // This is the subdir-located copy that Codex's marketplace install pipeline
  // actually consumes. Codex only follows paths inside the per-plugin source
  // directory, so the subdir must hold its own manifest. Content is kept in
  // sync with the root-level manifest by a CI invariant below.
  const file = 'plugins/phone-a-friend/.codex-plugin/plugin.json';

  it('exists', () => {
    expect(existsSync(join(REPO, file))).toBe(true);
  });

  it('parses as valid JSON', () => {
    expect(() => readJson(file)).not.toThrow();
  });

  it('declares the required fields name, version, description', () => {
    const manifest = readJson(file) as Record<string, unknown>;
    expect(manifest.name).toBe('phone-a-friend');
    expect(typeof manifest.version).toBe('string');
    expect(typeof manifest.description).toBe('string');
  });

  it('declares version matching package.json (CI-blocking invariant)', () => {
    const manifest = readJson(file) as { version: string };
    expect(manifest.version).toBe(packageVersion);
  });

  it('shares name + version with the root .codex-plugin/plugin.json', () => {
    const root = readJson('.codex-plugin/plugin.json') as { name: string; version: string };
    const subdir = readJson(file) as { name: string; version: string };
    expect(subdir.name).toBe(root.name);
    expect(subdir.version).toBe(root.version);
  });
});

describe('Codex marketplace manifest (.agents/plugins/marketplace.json)', () => {
  const file = '.agents/plugins/marketplace.json';

  it('exists', () => {
    expect(existsSync(join(REPO, file))).toBe(true);
  });

  it('parses as valid JSON', () => {
    expect(() => readJson(file)).not.toThrow();
  });

  it('declares marketplace name phone-a-friend-marketplace', () => {
    const manifest = readJson(file) as { name: string };
    expect(manifest.name).toBe('phone-a-friend-marketplace');
  });

  it('lists phone-a-friend with a local source pointing at the subdir', () => {
    const manifest = readJson(file) as {
      plugins: Array<{ name: string; source: { source: string; path: string } }>;
    };
    expect(Array.isArray(manifest.plugins)).toBe(true);
    expect(manifest.plugins.length).toBeGreaterThan(0);

    const paf = manifest.plugins.find((p) => p.name === 'phone-a-friend');
    expect(paf).toBeDefined();
    expect(paf!.source.source).toBe('local');
    // Codex requires the plugin source to be a subdirectory, not "./". We use
    // ./plugins/phone-a-friend/. Confirm we did NOT regress to "./".
    expect(paf!.source.path).not.toBe('./');
    expect(paf!.source.path.includes('plugins/phone-a-friend')).toBe(true);
  });
});

describe('No subagent personas are referenced from the active install path', () => {
  // The earlier paf-reviewer / paf-critic / paf-synthesizer subagent design
  // was dropped because Codex subagents only spawn on explicit
  // natural-language request, making them a poor fit for everyday relay.
  // /phone-a-team for Codex is now a pure Bash-orchestrated skill. The
  // orphaned TOML files may still exist under agents/codex/ until the user
  // authorizes deletion (per the global "never delete without permission"
  // rule), but they must not be installed, manifested, or referenced from
  // the active install path.

  it('root .codex-plugin/plugin.json does NOT declare an agents field', () => {
    const manifest = readJson('.codex-plugin/plugin.json') as Record<string, unknown>;
    expect(manifest.agents).toBeUndefined();
  });

  it('subdir plugins/phone-a-friend/.codex-plugin/plugin.json does NOT declare an agents field', () => {
    const manifest = readJson('plugins/phone-a-friend/.codex-plugin/plugin.json') as Record<string, unknown>;
    expect(manifest.agents).toBeUndefined();
  });
});

// Suppress unused-import warning if no more TOML tests run. (readToml is
// still potentially useful for future expansion.)
void readToml;

describe('claude-plugin and codex-plugin manifest version sync', () => {
  it('package.json, .claude-plugin/plugin.json, root .codex-plugin/plugin.json, and subdir agree', () => {
    const claude = readJson('.claude-plugin/plugin.json') as { version: string };
    const codexRoot = readJson('.codex-plugin/plugin.json') as { version: string };
    const codexSubdir = readJson('plugins/phone-a-friend/.codex-plugin/plugin.json') as {
      version: string;
    };
    expect(claude.version).toBe(packageVersion);
    expect(codexRoot.version).toBe(packageVersion);
    expect(codexSubdir.version).toBe(packageVersion);
  });
});

/**
 * Pinned invariants for the paf-tasks Claude Code mod (mods/paf-tasks/).
 *
 * The mod is its own plugin in the Claude marketplace, sourced by relative
 * path so it is opt-in and never part of the main `phone-a-friend` plugin
 * (its userConfig `options` would stop Claude Code before 2.1.271 from
 * loading the whole plugin). These tests keep the packaging honest: the
 * marketplace entry resolves, npm ships the folder for directory-registered
 * marketplaces, and the version moves with every release.
 *
 * The mod's own behaviour is tested by `claude plugin test mods/paf-tasks`
 * (see the paf-tasks job in .github/workflows/ci.yml), not by vitest.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..');
const MOD = 'mods/paf-tasks';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(REPO, rel), 'utf-8')) as T;
const readText = (rel: string): string => readFileSync(join(REPO, rel), 'utf-8');

type Manifest = { name: string; version: string; types?: string };
type Marketplace = { plugins: { name: string; source: unknown }[] };

describe('paf-tasks mod packaging', () => {
  const manifest = readJson<Manifest>(`${MOD}/.claude-plugin/plugin.json`);

  it('shares its version with package.json', () => {
    expect(manifest.version).toBe(readJson<{ version: string }>('package.json').version);
  });

  it('is bumped by the release scripts', () => {
    expect(readText('scripts/bump-version.mjs')).toContain(`"${MOD}/.claude-plugin/plugin.json"`);
    expect(readText('.github/workflows/auto-bump.yml')).toContain(`${MOD}/.claude-plugin/plugin.json`);
  });

  it('is listed in the Claude marketplace as its own plugin, by relative path', () => {
    const entry = readJson<Marketplace>('.claude-plugin/marketplace.json').plugins.find(plugin => plugin.name === manifest.name);
    expect(entry?.source).toBe(`./${MOD}`);
    expect(existsSync(join(REPO, MOD, '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('is not part of the main phone-a-friend plugin', () => {
    expect(manifest.name).not.toBe(readJson<Manifest>('.claude-plugin/plugin.json').name);
    expect(existsSync(join(REPO, 'hooks', 'hooks.json'))).toBe(false);
  });

  it('ships in the npm package, for marketplaces registered from the installed folder', () => {
    expect(readJson<{ files: string[] }>('package.json').files).toContain('mods/');
  });

  it('declares its hooks module and state contract', () => {
    expect(readJson<{ modules: string[] }>(`${MOD}/hooks/hooks.json`).modules).toEqual(['./register.tsx']);
    expect(manifest.types).toBe('./types/index.d.ts');
    expect(existsSync(join(REPO, MOD, 'types', 'index.d.ts'))).toBe(true);
  });

  it('keeps Claude Code generated types out of git', () => {
    expect(readText('.gitignore')).toMatch(/^\.claude-plugin\/types\/$/m);
  });
});

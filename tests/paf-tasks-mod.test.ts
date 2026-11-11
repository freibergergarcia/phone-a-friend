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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

  it('ships the project license and notice, since it installs as its own plugin', () => {
    expect(readText(`${MOD}/LICENSE`)).toBe(readText('LICENSE'));
    expect(readText(`${MOD}/NOTICE`)).toBe(readText('NOTICE'));
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

/**
 * The pane is unreadable when a color is chosen in the wrong place: the
 * terminal painted a docked pane in the theme's background under text in the
 * terminal's own foreground (black on black with a dark theme in a light
 * terminal), and `inverse` takes its text color from the terminal's background
 * (white on yellow). So every color lives in hooks/palette.ts, the pane is
 * opened transparent, and nothing else may name a color.
 *
 * This reads the source, because the mod's own tests see the tree a hook
 * returns and not every branch that draws one.
 */
describe('paf-tasks mod colors', () => {
  const HOOKS = `${MOD}/hooks`;
  const sources = readdirSync(join(REPO, HOOKS))
    .filter(name => /\.tsx?$/.test(name) && name !== 'palette.ts')
    .map(name => ({ name, code: readText(`${HOOKS}/${name}`) }));

  // Comments may say "gray" or "inverse"; code may not.
  const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

  const RAW = /(['"`])(?:black|red|green|yellow|blue|magenta|cyan|white|gr[ae]y)(?:Bright)?\1|(['"`])#[0-9a-fA-F]{3,8}\2/g;
  const PAINTED = /\b(?:color|backgroundColor|borderColor)\s*[=:]\s*\{?\s*(['"`])([^'"`]*)\1/g;
  const INVERSE = /\sinverse(?=[\s=>/}])/g;

  const violations = (code: string): string[] => {
    const bare = stripComments(code);
    return [
      ...[...bare.matchAll(RAW)].map(found => `raw color ${found[0]}`),
      ...[...bare.matchAll(PAINTED)].filter(found => found[2] !== 'transparent').map(found => `color literal ${found[0]}`),
      ...[...bare.matchAll(INVERSE)].map(() => 'inverse'),
    ];
  };

  it('reads every hooks module but the palette', () => {
    expect(sources.map(source => source.name).sort()).toEqual(['format.ts', 'model.ts', 'register.tsx']);
  });

  it('would catch each way a color has gone wrong before', () => {
    expect(violations(`<Text color="red">x</Text>`)).toEqual(['raw color "red"', 'color literal color="red"']);
    expect(violations(`idle: { color: 'gray', word: 'idle' }`)).toEqual([`raw color 'gray'`, `color literal color: 'gray'`]);
    expect(violations(`<Text color={isHere ? 'cyan' : look.color}>`)).toEqual([`raw color 'cyan'`]);
    expect(violations(`<Text color="error">x</Text>`)).toEqual(['color literal color="error"']);
    expect(violations(`<Box backgroundColor="#1e1e2e" />`)).toEqual(['raw color "#1e1e2e"', 'color literal backgroundColor="#1e1e2e"']);
    expect(violations(`<Text inverse bold color={LIVE_COLOR}>`)).toEqual(['inverse']);
    expect(violations(`<Text\n  inverse\n>`)).toEqual(['inverse']);
    // What is allowed: a palette name, the transparent pane, and words in comments.
    expect(violations(`<Text bold color={LABEL_TEXT} backgroundColor={LIVE_COLOR}>`)).toEqual([]);
    expect(violations(`const PANE_OPEN = { rows: 16, backgroundColor: 'transparent' } as const`)).toEqual([]);
    expect(violations(`// a gray "inverse" label, color: 'red'\nconst x = 1 /* color="red" */`)).toEqual([]);
  });

  it('names no color outside hooks/palette.ts, and never uses inverse', () => {
    for (const { name, code } of sources) expect({ name, violations: violations(code) }).toEqual({ name, violations: [] });
  });

  it('keeps the palette to theme keys, with cyan the one raw color', () => {
    const THEME_KEYS = ['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide'];
    const palette = [...stripComments(readText(`${HOOKS}/palette.ts`)).matchAll(/export const (\w+) = '([^']+)'/g)].map(found => [found[1], found[2]]);
    expect(palette.map(([name]) => name).sort()).toEqual(['ERROR_COLOR', 'LABEL_TEXT', 'LIVE_COLOR', 'OK_COLOR', 'SUBTLE', 'WARN_COLOR']);
    expect(palette.filter(([, value]) => !THEME_KEYS.includes(value as string))).toEqual([['LIVE_COLOR', 'cyan']]);
  });

  it('opens the pane transparent on every path', () => {
    const register = stripComments(readText(`${HOOKS}/register.tsx`));
    expect(register).toMatch(/const PANE_OPEN = \{[^}]*backgroundColor: 'transparent'[^}]*\} as const/);
    const opens = [...register.matchAll(/\$\.ui\.open\(([^)]*)\)/g)].map(found => found[1]);
    expect(opens.length).toBeGreaterThanOrEqual(4);
    expect(opens.filter(args => !/^(?:PANE_OPEN|\{ \.\.\.PANE_OPEN\b)/.test(args as string))).toEqual([]);
  });
});

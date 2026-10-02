/**
 * pi reads this npm package as a "pi package" (pi docs: packages.md). The
 * `pi` manifest in package.json pins which skills it loads, and must agree
 * with what `plugin install --pi` installs and with what the package ships.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { installHosts } from '../src/installer.js';

const repoRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const PI_SKILL_NAMES = ['curiosity-engine', 'phone-a-friend'];

function frontmatter(file: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf-8'));
  if (!match) throw new Error(`No frontmatter in ${file}`);
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2];
  }
  return fields;
}

describe('pi package manifest', () => {
  let piHome: string | null = null;

  afterEach(() => {
    if (piHome) fs.rmSync(piHome, { recursive: true, force: true });
    piHome = null;
  });

  it('declares exactly the skills pi hosts get, and no other resource type', () => {
    expect(pkg.pi).toEqual({
      skills: ['./skills/phone-a-friend', './skills/curiosity-engine'],
      extensions: [],
      prompts: [],
      themes: [],
    });
  });

  it('points at skill directories that the npm package ships', () => {
    expect(pkg.files).toContain('skills/');
    for (const entry of pkg.pi.skills as string[]) {
      expect(fs.existsSync(path.join(repoRoot, entry, 'SKILL.md'))).toBe(true);
    }
  });

  it('matches what `plugin install --pi` installs from this repository', () => {
    piHome = fs.mkdtempSync(path.join(os.tmpdir(), 'paf-pi-manifest-'));
    installHosts({ repoRoot, target: 'pi', mode: 'copy', piHome, syncClaudeCli: false, syncCodexCli: false });

    expect(fs.readdirSync(path.join(piHome, 'skills')).sort()).toEqual(PI_SKILL_NAMES);
    expect((pkg.pi.skills as string[]).map((entry) => path.basename(entry)).sort()).toEqual(PI_SKILL_NAMES);
  });

  it('opts into the public pi package gallery', () => {
    expect(pkg.keywords).toContain('pi-package');
  });

  // pi skips a skill with a malformed SKILL.md or no description (skills.md).
  it.each(PI_SKILL_NAMES)('%s has frontmatter pi accepts', (name) => {
    const fields = frontmatter(path.join(repoRoot, 'skills', name, 'SKILL.md'));

    expect(fields.name).toBe(name);
    expect(fields.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(fields.name.length).toBeLessThanOrEqual(64);
    expect(fields.description.length).toBeGreaterThan(0);
    expect(fields.description.length).toBeLessThanOrEqual(1024);
  });
});

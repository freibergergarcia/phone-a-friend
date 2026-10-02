import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Reject links, including directory links: submitted packages must be standalone.
export function filesIn(dir, prefix = '') {
  if (lstatSync(dir).isSymbolicLink()) throw new Error(`Symlink in package: ${dir}`);
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlink in package: ${path}`);
    if (stat.isDirectory()) return filesIn(path, rel);
    if (!stat.isFile()) throw new Error(`Not a regular file: ${path}`);
    return [rel];
  });
}

export function addFile(expected, dest, source) {
  if (!lstatSync(join(root, source)).isFile()) throw new Error(`Not a regular source: ${source}`);
  expected.set(dest, readFileSync(join(root, source)));
}

export function addTree(expected, dest, source) {
  for (const file of filesIn(join(root, source))) addFile(expected, `${dest}/${file}`, `${source}/${file}`);
}

export function addSkill(expected, name, host) {
  const base = `skills/${name}`;
  const source = host === 'codex' && existsSync(join(root, base, '.codex/SKILL.md'))
    ? `${base}/.codex` : base;
  addFile(expected, `${base}/SKILL.md`, `${source}/SKILL.md`);
  for (const resource of ['references', 'scripts', 'assets']) {
    if (existsSync(join(root, source, resource))) addTree(expected, `${base}/${resource}`, `${source}/${resource}`);
  }
}

export function addCommon(expected) {
  for (const file of ['LICENSE', 'NOTICE', 'PRIVACY.md', 'SUPPORT.md', 'assets/plugin-icon.svg']) addFile(expected, file, file);
  addFile(expected, 'README.md', 'docs/distribution/plugin-readme.md');
}

export function syncPackage(destination, expected, mode) {
  if (mode !== undefined && mode !== '--check') throw new Error('Usage: sync script [--check]');
  const dir = join(root, destination);
  if (mode === '--check') {
    const actual = existsSync(dir) ? filesIn(dir) : [];
    const missing = [...expected.keys()].filter((file) => !actual.includes(file));
    const extra = actual.filter((file) => !expected.has(file));
    const changed = actual.filter((file) => expected.has(file) && !readFileSync(join(dir, file)).equals(expected.get(file)));
    if (missing.length || extra.length || changed.length) throw new Error(`${destination} drift: ${JSON.stringify({ missing, extra, changed })}. Run npm run plugins:sync`);
    console.log(`${destination}: ${actual.length} files in sync`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  for (const [file, bytes] of expected) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), bytes);
  }
  console.log(`${destination}: synced ${expected.size} files`);
}

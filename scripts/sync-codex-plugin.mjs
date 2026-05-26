#!/usr/bin/env node

/**
 * Sync skills/<name>/{,.codex/}SKILL.md into plugins/phone-a-friend/skills/<name>/SKILL.md
 * so Codex marketplace install delivers working skills standalone.
 *
 * Codex caches whatever lives at the marketplace source path (here
 * `plugins/phone-a-friend/`). Codex auto-discovers SKILL.md files under the
 * directory declared by `skills:` in the per-plugin plugin.json. We mirror
 * the same overlay precedence as codexSkillSource() in src/installer.ts:
 * prefer skills/<name>/.codex/SKILL.md when present, else skills/<name>/SKILL.md.
 *
 * Usage:
 *   node scripts/sync-codex-plugin.mjs          # write/refresh files
 *   node scripts/sync-codex-plugin.mjs --check  # exit 1 if drift exists
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const CODEX_SKILLS = ['phone-a-friend', 'curiosity-engine', 'phone-a-team'];
const SRC_ROOT = resolve(root, 'skills');
const DEST_ROOT = resolve(root, 'plugins/phone-a-friend/skills');

function sourceFor(name) {
  const overlay = resolve(SRC_ROOT, name, '.codex/SKILL.md');
  if (existsSync(overlay)) return overlay;
  const plain = resolve(SRC_ROOT, name, 'SKILL.md');
  if (existsSync(plain)) return plain;
  throw new Error(`No SKILL.md found for "${name}" (looked in .codex/ and base)`);
}

function expected() {
  return CODEX_SKILLS.map((name) => ({
    name,
    src: sourceFor(name),
    dest: resolve(DEST_ROOT, name, 'SKILL.md'),
  }));
}

function check() {
  let drift = false;
  for (const { name, src, dest } of expected()) {
    if (!existsSync(dest)) {
      console.error(`drift: missing ${dest}`);
      drift = true;
      continue;
    }
    if (readFileSync(src, 'utf8') !== readFileSync(dest, 'utf8')) {
      console.error(`drift: ${dest} does not match ${src}`);
      drift = true;
    }
  }
  if (drift) {
    console.error('\nRun: node scripts/sync-codex-plugin.mjs');
    process.exit(1);
  }
  console.log('codex plugin skills in sync');
}

function write() {
  rmSync(DEST_ROOT, { recursive: true, force: true });
  for (const { name, src, dest } of expected()) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src, 'utf8'));
    console.log(`synced ${name}: ${src} -> ${dest}`);
  }
}

const mode = process.argv[2];
if (mode === '--check') {
  check();
} else if (mode === undefined) {
  write();
} else {
  console.error(`Usage: ${process.argv[1]} [--check]`);
  process.exit(1);
}

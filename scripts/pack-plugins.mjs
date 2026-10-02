#!/usr/bin/env node
// Run via npm run plugins:pack. Requires Info-ZIP's zip on macOS/Linux.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { filesIn, root } from './plugin-files.mjs';

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const output = join(root, 'artifacts/plugins');
mkdirSync(output, { recursive: true });
const sums = [];
for (const [host, source] of [['codex', 'plugins/phone-a-friend'], ['claude', 'plugins/claude']]) {
  const file = `phone-a-friend-${host}-${version}.zip`;
  const dest = join(output, file);
  rmSync(dest, { force: true });
  execFileSync('zip', ['-X', '-q', dest, ...filesIn(join(root, source))], { cwd: join(root, source) });
  sums.push(`${createHash('sha256').update(readFileSync(dest)).digest('hex')}  ${file}`);
  console.log(`artifacts/plugins/${file}`);
}
writeFileSync(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);

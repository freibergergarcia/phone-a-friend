#!/usr/bin/env node
// Local preflight, not a substitute for the vendors' authenticated validators.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { load } from 'js-yaml';
import { filesIn, root } from './plugin-files.mjs';

const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const pkg = json('package.json');
assert(pkg.keywords.includes('pi-package'), 'pi catalog keyword missing');
assert(!pkg.scripts.preuninstall && !pkg.scripts.uninstall && !pkg.scripts.postuninstall, 'Package removal must preserve user state');

for (const [folder, manifestFile] of [
  ['plugins/phone-a-friend', '.codex-plugin/plugin.json'],
  ['plugins/claude', '.claude-plugin/plugin.json'],
]) {
  const dir = join(root, folder);
  const files = filesIn(dir);
  const manifest = json(`${folder}/${manifestFile}`);
  assert.equal(manifest.version, pkg.version, `${folder}: version drift`);
  for (const required of ['README.md', 'LICENSE', 'NOTICE', 'PRIVACY.md', 'SUPPORT.md']) assert(files.includes(required), `${folder}: missing ${required}`);
  assert(!files.some((file) => /(^|\/)(node_modules|dist)(\/|$)|(^|\/)(package(-lock)?\.json|CLAUDE\.md)$/.test(file)), `${folder}: unneeded runtime/dependency file`);
  for (const file of files) {
    const bytes = readFileSync(join(dir, file));
    assert(bytes.length <= 256 * 1024, `${folder}/${file}: oversized text/asset`);
    if (file.endsWith('/SKILL.md') || file.startsWith('commands/')) {
      const text = bytes.toString('utf8');
      const match = /^---\n([\s\S]*?)\n---/.exec(text);
      assert(match, `${file}: missing frontmatter`);
      const header = load(match[1]);
      assert.equal(typeof header.name, 'string', `${file}: missing name`);
      assert.equal(typeof header.description, 'string', `${file}: missing description`);
      assert(header.description.length > 0 && header.description.length <= 1024, `${file}: description length`);
      if (header['argument-hint'] !== undefined) assert.equal(typeof header['argument-hint'], 'string', `${file}: argument-hint must be text`);
    }
    if (file.endsWith('.md')) {
      for (const match of bytes.toString('utf8').matchAll(/\]\((references\/[^)#]+)(?:#[^)]*)?\)/g)) {
        const target = resolve(dir, dirname(file), match[1]);
        assert(target.startsWith(`${dir}${sep}`), `${file}: reference escapes plugin`);
        assert(files.includes(target.slice(dir.length + 1).split(sep).join('/')), `${file}: missing ${match[1]}`);
      }
    }
  }
  if (manifest.interface) {
    const ui = manifest.interface;
    for (const [field, limit] of Object.entries({ displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80 })) {
      assert(typeof ui[field] === 'string' && ui[field].trim().length > 0 && ui[field].length <= limit, `${field}: invalid listing text`);
    }
    assert(Array.isArray(ui.capabilities) && ui.capabilities.length <= 20);
    assert(ui.defaultPrompt.length <= 3 && ui.defaultPrompt.every((prompt) => prompt.length <= 128));
    for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL']) {
      const url = new URL(ui[field]);
      assert(url.protocol === 'https:' && !url.username && !url.password, `${field}: invalid public URL`);
    }
    for (const field of ['logo', 'composerIcon']) {
      assert(ui[field].startsWith('./') && files.includes(ui[field].slice(2)), `${field}: missing asset`);
      const svg = readFileSync(join(dir, ui[field]), 'utf8');
      assert(/viewBox="0 0 128 128"/.test(svg), `${field}: expected square 128px SVG`);
      assert(!/<script|<foreignObject|(?:href|src)\s*=/i.test(svg), `${field}: external or active SVG content`);
    }
  }
  console.log(`${folder}: local package checks passed (${files.length} files)`);
}

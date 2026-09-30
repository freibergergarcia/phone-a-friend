import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(__dirname, '..');
const fixtures: string[] = [];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'paf-distribution-test-'));
  fixtures.push(dir);
  for (const path of ['package.json', '.codex-plugin', '.claude-plugin', 'scripts', 'skills', 'commands', 'agents', 'assets', 'docs/distribution', 'LICENSE', 'NOTICE', 'PRIVACY.md', 'SUPPORT.md']) {
    cpSync(join(repo, path), join(dir, path), { recursive: true });
  }
  sync(dir);
  return dir;
}

function run(dir: string, script: string, ...args: string[]) {
  return execFileSync(process.execPath, [join(dir, 'scripts', script), ...args], { cwd: dir, encoding: 'utf8' });
}

function sync(dir: string) {
  run(dir, 'sync-codex-plugin.mjs');
  run(dir, 'sync-claude-plugin.mjs');
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('standalone plugin distribution', () => {
  it('detects missing resources and unexpected files, then repairs the exact generated tree', () => {
    const dir = fixture();
    for (const host of ['phone-a-friend', 'claude']) {
      const target = join(dir, 'plugins', host);
      const reference = 'skills/phone-a-friend/references/sessions.md';
      expect(readFileSync(join(target, reference), 'utf8')).toBe(readFileSync(join(dir, reference), 'utf8'));
      rmSync(join(target, reference));
      writeFileSync(join(target, 'stale.txt'), 'Must not ship');
      const script = host === 'claude' ? 'sync-claude-plugin.mjs' : 'sync-codex-plugin.mjs';
      const result = spawnSync(process.execPath, [join(dir, 'scripts', script), '--check'], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(reference);
      expect(result.stderr).toContain('stale.txt');
      run(dir, script);
      expect(existsSync(join(target, 'stale.txt'))).toBe(false);
      expect(() => run(dir, script, '--check')).not.toThrow();
    }
  });

  it('rejects symlinked supporting files rather than packaging external content', () => {
    const dir = fixture();
    const reference = join(dir, 'skills/phone-a-friend/references/sessions.md');
    rmSync(reference);
    symlinkSync(join(dir, 'LICENSE'), reference);
    const result = spawnSync(process.execPath, [join(dir, 'scripts/sync-codex-plugin.mjs')], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Symlink in package');
  });

  it('keeps both release artifacts synchronized after automatic version bumps', () => {
    const dir = fixture();
    const version = run(dir, 'bump-version.mjs', 'patch').trim();
    sync(dir);
    for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugins/claude/.claude-plugin/plugin.json', 'plugins/phone-a-friend/.codex-plugin/plugin.json']) {
      expect(JSON.parse(readFileSync(join(dir, path), 'utf8')).version).toBe(version);
    }
    run(dir, 'sync-codex-plugin.mjs', '--check');
    run(dir, 'sync-claude-plugin.mjs', '--check');
  });
});

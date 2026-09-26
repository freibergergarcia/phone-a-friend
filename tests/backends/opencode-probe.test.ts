import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectOpenCodeMajor, _resetOpenCodeMajorCache } from '../../src/backends/opencode.js';

// Real subprocess fixtures: a fake `opencode` on PATH records every call.
describe('detectOpenCodeMajor()', () => {
  let root: string;
  let bin: string;
  let log: string;

  function installCli(mode: '2x' | '1x' | 'beta' | 'hanging' | 'failed', dir = bin) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'opencode'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ mode: ${JSON.stringify(mode)}, args }) + '\\n');
if (${JSON.stringify(mode)} === 'hanging') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (${JSON.stringify(mode)} === 'failed') {
  console.error('Unrecognized flag: --version');
  process.exitCode = 1;
} else if (${JSON.stringify(mode)} === '2x') {
  console.log('opencode v2.0.14');
} else if (${JSON.stringify(mode)} === '1x') {
  console.log('1.18.32');
} else {
  console.log('opencode2 v0.0.0-beta-17823');
}
`, { mode: 0o755 });
  }

  function calls(): Array<{ mode: string; args: string[] }> {
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  }

  function env(): Record<string, string> {
    return { PATH: `${bin}:/usr/bin:/bin` };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-opencode-probe-'));
    bin = join(root, 'bin');
    log = join(root, 'calls.jsonl');
    _resetOpenCodeMajorCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports 2 for a 2.x binary and 1 for a 1.x binary', async () => {
    installCli('2x');
    expect(await detectOpenCodeMajor(env())).toBe(2);
    _resetOpenCodeMajorCache();
    installCli('1x');
    expect(await detectOpenCodeMajor(env())).toBe(1);
    expect(calls().map(c => c.args)).toEqual([['--version'], ['--version']]);
  });

  it('reports null for a beta build, a failed probe, and a hanging probe', async () => {
    installCli('beta');
    expect(await detectOpenCodeMajor(env())).toBeNull();
    _resetOpenCodeMajorCache();
    installCli('failed');
    expect(await detectOpenCodeMajor(env())).toBeNull();
    _resetOpenCodeMajorCache();
    installCli('hanging');
    expect(await detectOpenCodeMajor(env(), { timeoutMs: 300 })).toBeNull();
  });

  it('reports null when no opencode is on PATH', async () => {
    expect(await detectOpenCodeMajor({ PATH: `${root}/empty:/nonexistent` })).toBeNull();
    expect(calls()).toEqual([]);
  });

  it('probes once per executable and shares the in-flight probe between concurrent callers', async () => {
    installCli('2x');
    const results = await Promise.all([detectOpenCodeMajor(env()), detectOpenCodeMajor(env()), detectOpenCodeMajor(env())]);
    expect(results).toEqual([2, 2, 2]);
    expect(await detectOpenCodeMajor(env())).toBe(2);
    expect(calls()).toHaveLength(1);
  });

  it('probes again when PATH selects a different executable', async () => {
    installCli('2x');
    expect(await detectOpenCodeMajor(env())).toBe(2);
    const otherBin = join(root, 'other');
    installCli('1x', otherBin);
    expect(await detectOpenCodeMajor({ PATH: `${otherBin}:/usr/bin:/bin` })).toBe(1);
    expect(calls()).toHaveLength(2);
  });

  it('probes again when PATH changes even though it resolves to the same executable', async () => {
    // The cache key includes PATH, not only the resolved binary: a changed
    // PATH is a changed spawn environment and is probed on its own.
    installCli('2x');
    expect(await detectOpenCodeMajor(env())).toBe(2);
    expect(await detectOpenCodeMajor({ PATH: `${root}/empty:${bin}:/usr/bin:/bin` })).toBe(2);
    expect(calls()).toHaveLength(2);
  });

  it('resolves relative PATH entries against the spawn cwd, not the PaF cwd', async () => {
    // The relay spawns `opencode` with cwd = repoPath; execvp resolves a
    // relative PATH entry against that cwd. `PATH=bin` with cwd = root must
    // find root/bin/opencode even though PaF's own cwd has no such file.
    installCli('2x');
    expect(await detectOpenCodeMajor({ PATH: 'bin' }, { cwd: root })).toBe(2);
    expect(await detectOpenCodeMajor({ PATH: 'bin' }, { cwd: join(root, 'nowhere') })).toBeNull();
    expect(calls()).toHaveLength(1);
  });
});

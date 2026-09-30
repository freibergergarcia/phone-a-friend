import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PI_MIN_VERSION,
  _resetPiVersionCache,
  detectPiVersion,
  isSupportedPiVersion,
} from '../../src/backends/pi.js';

describe('isSupportedPiVersion()', () => {
  it('requires 0.79.0, the release that added --no-approve', () => {
    expect(PI_MIN_VERSION).toBe('0.79.0');
    expect(isSupportedPiVersion('0.79.0')).toBe(true);
    expect(isSupportedPiVersion('0.87.1')).toBe(true);
    expect(isSupportedPiVersion('0.100.0')).toBe(true);
    expect(isSupportedPiVersion('1.0.0')).toBe(true);
  });

  it('rejects older versions, comparing numerically', () => {
    expect(isSupportedPiVersion('0.78.9')).toBe(false);
    expect(isSupportedPiVersion('0.9.0')).toBe(false);
    expect(isSupportedPiVersion('0.8.100')).toBe(false);
  });

  it('accepts a pre-release suffix on a supported version and rejects garbage', () => {
    expect(isSupportedPiVersion('0.80.0-beta.1')).toBe(true);
    expect(isSupportedPiVersion('')).toBe(false);
    expect(isSupportedPiVersion('latest')).toBe(false);
  });
});

// Real subprocess fixtures: a fake `pi` on PATH records every call.
describe('detectPiVersion()', () => {
  let root: string;
  let bin: string;
  let log: string;

  function installCli(mode: string, dir = bin) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pi'), `#!${process.execPath}
const fs = require('node:fs');
const mode = ${JSON.stringify(mode)};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ mode, args: process.argv.slice(2) }) + '\\n');
if (mode === 'hanging') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (mode === 'failed') {
  console.error('Unknown option: --version');
  process.exitCode = 1;
} else {
  console.log(mode);
}
`, { mode: 0o755 });
  }

  function calls(): Array<{ mode: string; args: string[] }> {
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  }

  function env(): Record<string, string> {
    return { PATH: `${bin}:/usr/bin:/bin` };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-pi-probe-'));
    bin = join(root, 'bin');
    log = join(root, 'calls.jsonl');
    _resetPiVersionCache();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the version pi prints', async () => {
    installCli('0.87.1');
    const probe = await detectPiVersion(env());
    expect(probe).toMatchObject({ status: 'ok', version: '0.87.1' });
    expect(calls().map((c) => c.args)).toEqual([['--version']]);
  });

  it('reports a missing executable without running anything', async () => {
    expect(await detectPiVersion({ PATH: `${root}/empty:/nonexistent` })).toEqual({ status: 'missing' });
    expect(calls()).toEqual([]);
  });

  it('reports an unreadable version for a failed, garbled or hanging probe', async () => {
    installCli('failed');
    expect((await detectPiVersion(env())).status).toBe('unreadable');
    _resetPiVersionCache();
    installCli('not a version');
    expect((await detectPiVersion(env())).status).toBe('unreadable');
    _resetPiVersionCache();
    installCli('hanging');
    expect((await detectPiVersion(env(), { timeoutMs: 300 })).status).toBe('unreadable');
  });

  it('probes once per executable and shares the in-flight probe between concurrent callers', async () => {
    installCli('0.87.1');
    const results = await Promise.all([detectPiVersion(env()), detectPiVersion(env()), detectPiVersion(env())]);
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect((await detectPiVersion(env())).status).toBe('ok');
    expect(calls()).toHaveLength(1);
  });

  it('probes again when PATH selects a different executable', async () => {
    installCli('0.87.1');
    expect(await detectPiVersion(env())).toMatchObject({ version: '0.87.1' });
    const otherBin = join(root, 'other');
    installCli('0.70.0', otherBin);
    expect(await detectPiVersion({ PATH: `${otherBin}:/usr/bin:/bin` })).toMatchObject({ version: '0.70.0' });
    expect(calls()).toHaveLength(2);
  });

  it('probes again when PATH changes even though it resolves to the same executable', async () => {
    // The cache key includes PATH, not only the resolved binary: a changed
    // PATH is a changed spawn environment and is probed on its own.
    installCli('0.87.1');
    expect((await detectPiVersion(env())).status).toBe('ok');
    expect((await detectPiVersion({ PATH: `${root}/empty:${bin}:/usr/bin:/bin` })).status).toBe('ok');
    expect(calls()).toHaveLength(2);
  });

  it('resolves relative PATH entries against the spawn cwd, not the PaF cwd', async () => {
    // pi is spawned with cwd = the repo, and execvp resolves a relative PATH
    // entry against that cwd.
    installCli('0.87.1');
    expect((await detectPiVersion({ PATH: 'bin' }, { cwd: root })).status).toBe('ok');
    expect(await detectPiVersion({ PATH: 'bin' }, { cwd: join(root, 'nowhere') })).toEqual({ status: 'missing' });
    expect(calls()).toHaveLength(1);
  });
});

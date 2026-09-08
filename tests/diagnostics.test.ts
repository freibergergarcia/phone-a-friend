import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { getPackageRoot, getVersion } from '../src/version.js';

// Register the real backends so attachModelAndCapabilities can read declared
// capabilities from the registry, exactly as the CLI entry point does.
import '../src/backends/antigravity.js';
import '../src/backends/codex.js';
import '../src/backends/gemini.js';
import '../src/backends/ollama.js';
import '../src/backends/claude.js';
import '../src/backends/opencode.js';

import {
  resolveExecutableCandidates,
  probeVersion,
  parseVersionOutput,
  inspectExecutable,
  inspectExecutables,
  attachModelAndCapabilities,
  inspectPafIdentity,
} from '../src/diagnostics.js';
import type { DetectionReport } from '../src/detection.js';

// ---------------------------------------------------------------------------
// Fixtures: real executables in temp dirs so PATH resolution and version
// probing are exercised end-to-end without touching the real machine.
// ---------------------------------------------------------------------------

let root: string;
let binA: string;
let binB: string;
let binC: string;
let binBroken: string;

function script(dir: string, name: string, body: string, mode = 0o755): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, mode);
  return path;
}

beforeAll(() => {
  // realpath: macOS tmpdir lives under /var -> /private/var.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'paf-diag-')));
  binA = join(root, 'a');
  binB = join(root, 'b');
  binC = join(root, 'c');
  binBroken = join(root, 'broken');
  for (const d of [binA, binB, binC, binBroken]) mkdirSync(d);

  // Two distinct codex installs with different versions.
  script(binA, 'codex', 'echo "codex-cli 0.153.4"');
  script(binB, 'codex', 'echo "codex-cli 0.146.0"');
  // c/codex is a symlink to a/codex: must dedupe against it.
  symlinkSync(join(binA, 'codex'), join(binC, 'codex'));

  // Claude-style output.
  script(binA, 'claude', 'echo "2.1.263 (Claude Code)"');
  // Ollama-style: version on stderr, warning noise, exit 0.
  script(binA, 'ollama', 'echo "Warning: could not connect" >&2; echo "Warning: client version is 0.30.8" >&2');
  // Same version twice on PATH (a and b): shadowed but no mismatch.
  script(binA, 'gemini', 'echo 0.50.0');
  script(binB, 'gemini', 'echo 0.50.0');

  // Failure modes.
  script(binBroken, 'hangs', 'sleep 5');
  script(binBroken, 'exits1', 'echo "boom" >&2; exit 1');
  script(binBroken, 'garbage', 'echo "no numbers here"');
  // Shell builtins avoid Node startup contention and leave no child processes.
  script(binBroken, 'stubborn', "trap '' TERM; printf 'ready\\n'; while :; do :; done");
  script(binBroken, 'silent', ':');
  script(binBroken, 'noexec', 'echo 1.0.0', 0o644);
  // A directory with an executable's name must be ignored.
  mkdirSync(join(binBroken, 'agy'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// Fixture scripts need `sh`, `echo`, `sleep` from the system dirs; none of
// those dirs contain the backend command names under test.
function envWith(...dirs: string[]): NodeJS.ProcessEnv {
  return { PATH: [...dirs, '/usr/bin', '/bin'].join(delimiter) };
}

// ---------------------------------------------------------------------------
// parseVersionOutput
// ---------------------------------------------------------------------------

describe('parseVersionOutput', () => {
  it('parses common CLI version formats', () => {
    expect(parseVersionOutput('codex-cli 0.153.4\n', '')).toBe('0.153.4');
    expect(parseVersionOutput('2.1.263 (Claude Code)\n', '')).toBe('2.1.263');
    expect(parseVersionOutput('0.50.0\n', '')).toBe('0.50.0');
    expect(parseVersionOutput('v1.2.3-beta.1\n', '')).toBe('1.2.3-beta.1');
  });

  it('falls back to stderr when stdout has no version', () => {
    expect(parseVersionOutput('', 'Warning: client version is 0.30.8\n')).toBe('0.30.8');
  });

  it('returns null when nothing looks like a version', () => {
    expect(parseVersionOutput('no numbers here', 'still none')).toBeNull();
    expect(parseVersionOutput('1.2', '')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveExecutableCandidates
// ---------------------------------------------------------------------------

describe('resolveExecutableCandidates', () => {
  it('returns candidates in PATH order and marks the first as what spawn resolves', () => {
    const found = resolveExecutableCandidates('codex', envWith(binB, binA));
    expect(found.map(c => c.path)).toEqual([join(binB, 'codex'), join(binA, 'codex')]);
  });

  it('deduplicates symlinks that point at the same target', () => {
    const found = resolveExecutableCandidates('codex', envWith(binA, binC, binB));
    expect(found).toHaveLength(2);
    expect(found[0].path).toBe(join(binA, 'codex'));
    expect(found[0].resolvedPath).toBe(join(binA, 'codex'));
    // c/codex resolves to a/codex, so it is not listed twice.
    expect(found.some(c => c.path === join(binC, 'codex'))).toBe(false);
  });

  it('keeps the symlink path but reports the resolved target when the symlink comes first', () => {
    const found = resolveExecutableCandidates('codex', envWith(binC, binA));
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe(join(binC, 'codex'));
    expect(found[0].resolvedPath).toBe(join(binA, 'codex'));
  });

  it('ignores non-executable files, directories and missing dirs', () => {
    expect(resolveExecutableCandidates('noexec', envWith(binBroken))).toEqual([]);
    expect(resolveExecutableCandidates('agy', envWith(binBroken))).toEqual([]);
    expect(resolveExecutableCandidates('codex', envWith('', join(root, 'nope'), binA))).toHaveLength(1);
  });

  it('matches subprocess current-directory lookup for empty and relative PATH components', async () => {
    // Use a unique executable in cwd without changing process cwd inside Vitest workers.
    const name = `.paf-path-fixture-${process.pid}`;
    const local = script(process.cwd(), name, 'echo 1.2.3');
    script(binA, name, 'echo 4.5.6');
    try {
      const env = { PATH: `:${binA}` };
      const found = resolveExecutableCandidates(name, env);
      expect(found[0].resolvedPath).toBe(realpathSync(local));
      expect((await probeVersion(name, { env })).version).toBe('1.2.3');
      expect(resolveExecutableCandidates(name, { PATH: '' })[0].resolvedPath).toBe(realpathSync(local));
      expect(resolveExecutableCandidates(name, { PATH: relative(process.cwd(), binA) })[0].path)
        .toBe(join(binA, name));
    } finally { rmSync(local, { force: true }); }
  });

  it('returns nothing when PATH is unset or the command is absent', () => {
    expect(resolveExecutableCandidates('codex', {})).toEqual([]);
    expect(resolveExecutableCandidates('missing', envWith(binA, binB))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// probeVersion
// ---------------------------------------------------------------------------

describe('probeVersion', () => {
  it('parses a version from stdout', async () => {
    const r = await probeVersion(join(binA, 'codex'));
    expect(r).toEqual({ version: '0.153.4', versionStatus: 'ok' });
  });

  it('parses a version from stderr when stdout is empty (ollama style)', async () => {
    const r = await probeVersion(join(binA, 'ollama'));
    expect(r).toEqual({ version: '0.30.8', versionStatus: 'ok' });
  });

  it('times out hanging probes without hanging doctor', async () => {
    const started = Date.now();
    const r = await probeVersion(join(binBroken, 'hangs'), { timeoutMs: 200 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.versionStatus).toBe('timeout');
    expect(r.version).toBeNull();
    expect(r.versionError).toContain('did not finish');
  });

  it('terminates a probe that ignores SIGTERM', async () => {
    const tracked = vi.fn(execFile);
    const started = Date.now();
    const pending = probeVersion(join(binBroken, 'stubborn'), { timeoutMs: 1000, execFileFn: tracked });
    const child = tracked.mock.results[0].value;
    let ready = false;
    child.stdout?.on('data', () => { ready = true; });
    // Watchdog makes a broken implementation fail without leaving a fixture running.
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 3500);
    try {
      const result = await pending;
      expect(ready).toBe(true);
      expect(result.versionStatus).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(3000);
      expect(child.signalCode).toBe('SIGKILL');
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  it.each([0, 1])('does not copy private probe output into diagnostics (exit %s)', async (exit) => {
    const name = `private-${exit}`;
    script(binBroken, name, `echo 'SYNTHETIC_PRIVATE_TOKEN=marker' >&2; exit ${exit}`);
    const info = await inspectExecutable(name, { env: envWith(binBroken) });
    expect(info.selected?.versionStatus).toBe(exit ? 'failed' : 'unparsed');
    expect(JSON.stringify(info)).not.toContain('SYNTHETIC_PRIVATE_TOKEN');
    expect(info.guidance.join(' ')).toContain('--version');
  });

  it('reports non-zero exits as failed with a short reason', async () => {
    const r = await probeVersion(join(binBroken, 'exits1'));
    expect(r.versionStatus).toBe('failed');
    expect(r.version).toBeNull();
    expect(r.versionError).toBe('exit code 1');
  });

  it('reports unrecognized and empty output as unparsed', async () => {
    const garbage = await probeVersion(join(binBroken, 'garbage'));
    expect(garbage.versionStatus).toBe('unparsed');
    expect(garbage.versionError).toBe('unrecognized version output');

    const silent = await probeVersion(join(binBroken, 'silent'));
    expect(silent.versionStatus).toBe('unparsed');
    expect(silent.versionError).toBe('no output');
  });

  it('reports a missing executable as failed and a non-executable as permission-denied', async () => {
    const missing = await probeVersion(join(binBroken, 'does-not-exist'));
    expect(missing.versionStatus).toBe('failed');
    expect(missing.versionError).toContain('ENOENT');

    const noexec = await probeVersion(join(binBroken, 'noexec'));
    expect(noexec.versionStatus).toBe('permission-denied');
  });

  it('invokes the executable with argv only (no shell) and only --version', async () => {
    const spy = vi.fn(execFile) as unknown as typeof execFile;
    await probeVersion(join(binA, 'codex'), { execFileFn: spy });
    expect(spy).toHaveBeenCalledOnce();
    const [file, args, opts] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(file).toBe(join(binA, 'codex'));
    expect(args).toEqual(['--version']);
    expect(opts).not.toHaveProperty('shell');
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it('never throws when execFile itself errors synchronously-shaped', async () => {
    const failing = ((_f: string, _a: string[], _o: unknown, cb: (e: Error) => void) => {
      const err = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
      cb(err);
    }) as unknown as typeof execFile;
    const r = await probeVersion('/whatever', { execFileFn: failing });
    expect(r.versionStatus).toBe('permission-denied');
  });
});

// ---------------------------------------------------------------------------
// inspectExecutable
// ---------------------------------------------------------------------------

describe('inspectExecutable', () => {
  it('selects the first PATH match and flags version mismatch across candidates', async () => {
    const info = await inspectExecutable('codex', { env: envWith(binB, binA) });
    expect(info.command).toBe('codex');
    expect(info.selected?.path).toBe(join(binB, 'codex'));
    expect(info.selected?.version).toBe('0.146.0');
    expect(info.candidates.map(c => c.version)).toEqual(['0.146.0', '0.153.4']);
    expect(info.shadowed).toBe(true);
    expect(info.versionMismatch).toBe(true);
    expect(info.guidance.join('\n')).toMatch(/first PATH match for "codex"/);
    expect(info.guidance.join('\n')).toMatch(/different versions/);
    expect(info.guidance.join('\n')).toMatch(/aliases and functions do not affect/);
    // Guidance must not promise model compatibility from version alone.
    expect(info.guidance.join('\n')).toMatch(/does not by itself guarantee/);
  });

  it('reports duplicates with identical versions as shadowed but not mismatched', async () => {
    const info = await inspectExecutable('gemini', { env: envWith(binA, binB) });
    expect(info.shadowed).toBe(true);
    expect(info.versionMismatch).toBe(false);
    expect(info.guidance.join('\n')).toMatch(/same version/);
  });

  it('probes the selected symlink name rather than changing executable identity', async () => {
    const spy = vi.fn(execFile);
    await inspectExecutable('codex', { env: envWith(binC, binA), execFileFn: spy });
    expect(spy.mock.calls[0][0]).toBe(join(binC, 'codex'));
  });

  it('handles a single install with no guidance noise', async () => {
    const info = await inspectExecutable('claude', { env: envWith(binA) });
    expect(info.selected?.version).toBe('2.1.263');
    expect(info.shadowed).toBe(false);
    expect(info.versionMismatch).toBe(false);
    expect(info.guidance).toEqual([]);
  });

  it('reports a missing command as selected=null with no candidates', async () => {
    const info = await inspectExecutable('missing', { env: envWith(binA, binB) });
    expect(info.selected).toBeNull();
    expect(info.candidates).toEqual([]);
    expect(info.shadowed).toBe(false);
    expect(info.guidance).toEqual([]);
  });

  it('surfaces probe failures in guidance without failing the inspection', async () => {
    const info = await inspectExecutable('hangs', { env: envWith(binBroken), timeoutMs: 200 });
    expect(info.selected?.versionStatus).toBe('timeout');
    expect(info.guidance.join('\n')).toMatch(/Could not determine the version/);
    expect(info.guidance.join('\n')).toMatch(/--version" manually/);
  });

  it('caps the number of probes and marks the rest not-probed', async () => {
    const info = await inspectExecutable('codex', { env: envWith(binA, binB), maxProbes: 1 });
    expect(info.candidates[0].versionStatus).toBe('ok');
    expect(info.candidates[1].versionStatus).toBe('not-probed');
    expect(info.guidance.join('\n')).toMatch(/not probed/);
  });
});

// ---------------------------------------------------------------------------
// inspectExecutables (report decoration)
// ---------------------------------------------------------------------------

function makeReport(): DetectionReport {
  return {
    cli: [
      { name: 'antigravity', category: 'cli', available: false, detail: 'agy not found', installHint: 'x', optional: true },
      { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
      { name: 'gemini', category: 'cli', available: true, detail: 'found', installHint: '' },
      { name: 'someday', category: 'cli', available: false, detail: 'planned', installHint: '', planned: true },
    ],
    local: [
      { name: 'ollama', category: 'local', available: false, detail: 'not running', installHint: 'ollama serve' },
    ],
    host: [
      { name: 'claude', category: 'host', available: true, detail: 'found', installHint: '' },
      { name: 'codex', category: 'host', available: true, detail: 'found', installHint: '' },
    ],
    environment: { tmux: { active: false, installed: false }, agentTeams: { enabled: false } },
  };
}

describe('inspectExecutables', () => {
  it('attaches executable info to CLI, local and host entries, Claude included', async () => {
    const report = makeReport();
    await inspectExecutables(report, { env: envWith(binA, binB) });

    const codex = report.cli.find(b => b.name === 'codex')!;
    expect(codex.executable?.selected?.version).toBe('0.153.4');
    expect(codex.executable?.shadowed).toBe(true);

    const claude = report.host.find(b => b.name === 'claude')!;
    expect(claude.executable?.command).toBe('claude');
    expect(claude.executable?.selected?.version).toBe('2.1.263');

    const ollama = report.local[0];
    expect(ollama.executable?.selected?.version).toBe('0.30.8');

    // Antigravity maps to `agy`, which is absent here.
    const agy = report.cli.find(b => b.name === 'antigravity')!;
    expect(agy.executable?.command).toBe('agy');
    expect(agy.executable?.selected).toBeNull();
  });

  it('inspects a command shared across categories only once', async () => {
    const spy = vi.fn(execFile) as unknown as typeof execFile;
    const report = makeReport();
    await inspectExecutables(report, { env: envWith(binA), execFileFn: spy });
    const probedFiles = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(probedFiles.filter(f => f === join(binA, 'codex'))).toHaveLength(1);
    const cliCodex = report.cli.find(b => b.name === 'codex')!;
    const hostCodex = report.host.find(b => b.name === 'codex')!;
    expect(hostCodex.executable).toBe(cliCodex.executable);
  });

  it('skips planned backends and never invokes them', async () => {
    const spy = vi.fn(execFile) as unknown as typeof execFile;
    const report = makeReport();
    await inspectExecutables(report, { env: envWith(binA), execFileFn: spy });
    expect(report.cli.find(b => b.name === 'someday')!.executable).toBeUndefined();
  });

  it('leaves availability untouched (diagnostics never change detection verdicts)', async () => {
    const report = makeReport();
    const before = JSON.stringify([...report.cli, ...report.local, ...report.host].map(b => b.available));
    await inspectExecutables(report, { env: envWith(binBroken), timeoutMs: 200 });
    const after = JSON.stringify([...report.cli, ...report.local, ...report.host].map(b => b.available));
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// attachModelAndCapabilities
// ---------------------------------------------------------------------------

describe('attachModelAndCapabilities', () => {
  it('reports the configured model as requested and never manufactures a reported model', () => {
    const report = makeReport();
    attachModelAndCapabilities(report, {
      defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
      backends: { codex: { model: 'gpt-6-astra' } },
      gemini: { model: 'legacy-top-level' },
    });
    const codex = report.cli.find(b => b.name === 'codex')!;
    expect(codex.model).toEqual({
      requested: 'gpt-6-astra',
      requestedSource: 'paf-config',
      reported: null,
      reportedNote: expect.stringMatching(/does not run backends/),
    });
    const gemini = report.cli.find(b => b.name === 'gemini')!;
    expect(gemini.model?.requested).toBe('legacy-top-level');
    const claude = report.host.find(b => b.name === 'claude')!;
    expect(claude.model?.requested).toBeNull();
    expect(claude.model?.requestedSource).toBe('backend-default');
    expect(claude.model?.reported).toBeNull();
  });

  it('exposes declared capabilities and labels them as unverified', () => {
    const report = makeReport();
    attachModelAndCapabilities(report, {
      defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    });
    const codex = report.cli.find(b => b.name === 'codex')!;
    expect(codex.capabilities).toEqual({
      declared: { resumeStrategy: 'native-session', requiresClientSessionId: false, localFileAccess: true },
      verification: 'declared-only',
      verificationNote: expect.stringMatching(/not verified/),
    });
    const ollama = report.local[0];
    expect(ollama.capabilities?.declared).toEqual({
      resumeStrategy: 'transcript-replay',
      requiresClientSessionId: false,
      localFileAccess: false,
    });
    const claude = report.host.find(b => b.name === 'claude')!;
    expect(claude.capabilities?.declared.resumeStrategy).toBe('native-session');
    // Not a registered backend: no capabilities, no crash.
    const planned = report.cli.find(b => b.name === 'someday')!;
    expect(planned.capabilities).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// inspectPafIdentity
// ---------------------------------------------------------------------------

describe('inspectPafIdentity', () => {
  let pafRoot: string;
  let pafBin: string;
  let pafBin2: string;

  beforeAll(() => {
    pafRoot = realpathSync(mkdtempSync(join(tmpdir(), 'paf-identity-')));
    const mk = (name: string, version: string, bin: string) => {
      const pkg = join(pafRoot, 'lib', name);
      mkdirSync(join(pkg, 'dist'), { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@freibergergarcia/phone-a-friend', version }));
      writeFileSync(join(pkg, 'dist', 'index.js'), '#!/usr/bin/env node\n');
      chmodSync(join(pkg, 'dist', 'index.js'), 0o755);
      mkdirSync(bin, { recursive: true });
      symlinkSync(join(pkg, 'dist', 'index.js'), join(bin, 'phone-a-friend'));
    };
    pafBin = join(pafRoot, 'bin1');
    pafBin2 = join(pafRoot, 'bin2');
    mk('paf-new', '4.4.0', pafBin);
    mk('paf-old', '4.0.0', pafBin2);
  });

  afterAll(() => {
    rmSync(pafRoot, { recursive: true, force: true });
  });

  it('reads PATH install versions from package.json without running anything', () => {
    const id = inspectPafIdentity({ env: envWith(pafBin, pafBin2), argv1: undefined });
    expect(id.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(id.pathCandidates.map(c => c.version)).toEqual(['4.4.0', '4.0.0']);
    expect(id.pathCandidates[0].versionStatus).toBe('ok');
    expect(id.entry).toBeNull();
  });

  it('flags when the PATH install is a different build from the running one', () => {
    const id = inspectPafIdentity({ env: envWith(pafBin2, pafBin) });
    expect(id.runningDiffersFromPath).toBe(true);
    expect(id.guidance.join('\n')).toMatch(/on PATH resolves to/);
    expect(id.guidance.join('\n')).toMatch(/Multiple phone-a-friend installs/);
  });

  it('is calm when phone-a-friend is not on PATH at all', () => {
    const id = inspectPafIdentity({ env: envWith(binA) });
    expect(id.pathCandidates).toEqual([]);
    expect(id.runningDiffersFromPath).toBe(false);
    expect(id.guidance).toEqual([]);
  });

  it('recognizes this checkout launcher without a false different-build warning', () => {
    const repo = getPackageRoot();
    const id = inspectPafIdentity({ env: { PATH: repo }, argv1: join(repo, 'dist', 'index.js') });
    expect(id.pathCandidates[0].version).toBe(getVersion());
    expect(id.pathCandidates[0].versionStatus).toBe('ok');
    expect(id.runningDiffersFromPath).toBe(false);
    expect(id.guidance).toEqual([]);
  });

  it('does not borrow an unrelated parent package version for an unknown wrapper', () => {
    const packageDir = join(pafRoot, 'unrelated');
    const bin = join(packageDir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'another-tool', version: '9.9.9' }));
    script(bin, 'phone-a-friend', 'echo 9.9.9');
    const id = inspectPafIdentity({ env: { PATH: bin } });
    expect(id.pathCandidates[0].version).toBeNull();
    expect(id.pathCandidates[0].versionStatus).toBe('unparsed');
    expect(id.runningDiffersFromPath).toBe(false);
  });

  it('marks an install without a readable package.json as unparsed instead of guessing', () => {
    const bare = join(pafRoot, 'bare');
    mkdirSync(bare, { recursive: true });
    script(bare, 'phone-a-friend', 'echo 9.9.9');
    const id = inspectPafIdentity({ env: envWith(bare) });
    expect(id.pathCandidates[0].versionStatus).toBe('unparsed');
    expect(id.pathCandidates[0].version).toBeNull();
  });
});

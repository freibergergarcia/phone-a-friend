import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { SandboxMode } from '../../src/backends/index.js';

const { mockExecFileSync, mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync, execFile: mockExecFile, spawn: mockSpawn };
});

import { CODEX_BACKEND } from '../../src/backends/codex.js';

function fakeChild(stdout: string) {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  process.nextTick(() => {
    child.stdout.end(stdout);
    child.stderr.end();
    child.emit('close', 0, null);
  });
  return child;
}

/**
 * `codex exec resume` accepts neither `--sandbox` nor `-C`. Verified live on
 * codex-cli 0.157.1 (2026-09-26): a thread started read-only, resumed with
 * PaF's previous arguments, created a file; the same resume with
 * `-c sandbox_mode="read-only"` was denied. A resume also ran `pwd` in the
 * caller's cwd, not the thread's repo. Both are fixed on the resume branch.
 */
describe('Codex resume keeps sandbox and repo root', () => {
  const base = {
    prompt: 'continue',
    repoPath: '/tmp/repo-under-test',
    timeoutSeconds: 60,
    model: null,
    env: { PATH: '/usr/bin' },
    sessionId: 'thread-123',
    resumeSession: true,
    persistSession: true,
  };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    mockExecFileSync.mockReturnValue('/usr/local/bin/codex');
    mockSpawn.mockImplementation(() => fakeChild('{"type":"thread.started","thread_id":"thread-123"}\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n'));
  });

  it.each(['read-only', 'workspace-write', 'danger-full-access'] as SandboxMode[])(
    'passes the %s sandbox as a config override on resume',
    async (sandbox) => {
      await CODEX_BACKEND.run({ ...base, sandbox });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-123']);
      const idx = args.indexOf('-c');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe(`sandbox_mode="${sandbox}"`);
      expect(args).not.toContain('--sandbox');
      expect(args).not.toContain('-C');
    },
  );

  it('spawns the resume in the repo directory', async () => {
    await CODEX_BACKEND.run({ ...base, sandbox: 'read-only' });
    const spawnOpts = mockSpawn.mock.calls[0][2] as { cwd?: string };
    expect(spawnOpts.cwd).toBe('/tmp/repo-under-test');
  });

  it('keeps the output file and JSON flags on resume', async () => {
    await CODEX_BACKEND.run({ ...base, sandbox: 'read-only' });
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('-o');
    expect(args).toContain('--json');
    expect(args).toContain('--skip-git-repo-check');
    expect(args[args.length - 1]).toBe('continue');
  });

  it('leaves a fresh exec untouched: -C and --sandbox, no config override', async () => {
    await CODEX_BACKEND.run({ ...base, sandbox: 'workspace-write', sessionId: null, resumeSession: false, persistSession: false });
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args.slice(0, 3)).toEqual(['exec', '-C', '/tmp/repo-under-test']);
    expect(args).toContain('--sandbox');
    expect(args).not.toContain('-c');
  });
});

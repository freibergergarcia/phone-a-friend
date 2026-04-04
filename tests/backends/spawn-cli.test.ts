import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mockSpawn };
});

import { spawnCli, BackendError } from '../../src/backends/index.js';

function fakeChild(exitCode = 0, stdout = '', stderr = '') {
  const child = new EventEmitter() as ChildProcess;
  const out = new PassThrough();
  const err = new PassThrough();
  (child as any).stdout = out;
  (child as any).stderr = err;
  (child as any).killed = false;
  (child as any).kill = vi.fn(() => {
    (child as any).killed = true;
  });
  process.nextTick(() => {
    if (stdout) out.write(stdout);
    out.end();
    if (stderr) err.write(stderr);
    err.end();
    child.emit('close', exitCode, null);
  });
  return child;
}

describe('spawnCli()', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('resolves with stdout on exit code 0', async () => {
    mockSpawn.mockReturnValue(fakeChild(0, 'hello world'));
    const result = await spawnCli('echo', ['hello'], { timeoutMs: 5000 });
    expect(result.stdout).toBe('hello world');
    expect(result.exitCode).toBe(0);
  });

  it('resolves with empty stdout when process produces no output', async () => {
    mockSpawn.mockReturnValue(fakeChild(0, ''));
    const result = await spawnCli('quiet', [], { timeoutMs: 5000 });
    expect(result.stdout).toBe('');
  });

  it('captures stderr alongside stdout', async () => {
    mockSpawn.mockReturnValue(fakeChild(0, 'out', 'warn'));
    const result = await spawnCli('cmd', [], { timeoutMs: 5000 });
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('warn');
  });

  it('rejects with BackendError on non-zero exit code', async () => {
    mockSpawn.mockReturnValue(fakeChild(1, '', 'bad input'));
    const err = await spawnCli('bad', [], { timeoutMs: 5000 }).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.message).toBe('bad input');
  });

  it('uses stdout as error detail when stderr is empty', async () => {
    mockSpawn.mockReturnValue(fakeChild(1, 'stdout error', ''));
    await expect(spawnCli('bad', [], { timeoutMs: 5000 }))
      .rejects.toThrow('stdout error');
  });

  it('rejects on timeout with descriptive message', async () => {
    const child = new EventEmitter() as ChildProcess;
    (child as any).stdout = new PassThrough();
    (child as any).stderr = new PassThrough();
    (child as any).killed = false;
    (child as any).kill = vi.fn(() => {
      (child as any).killed = true;
      process.nextTick(() => child.emit('close', null, 'SIGTERM'));
    });
    mockSpawn.mockReturnValue(child);

    await expect(spawnCli('slow', [], { timeoutMs: 10, label: 'slow-cmd' }))
      .rejects.toThrow(/slow-cmd timed out/);
  });

  it('rejects on signal kill', async () => {
    const child = new EventEmitter() as ChildProcess;
    (child as any).stdout = new PassThrough();
    (child as any).stderr = new PassThrough();
    (child as any).killed = false;
    (child as any).kill = vi.fn();
    mockSpawn.mockReturnValue(child);
    process.nextTick(() => child.emit('close', null, 'SIGKILL'));

    await expect(spawnCli('killed', [], { timeoutMs: 5000 }))
      .rejects.toThrow(/SIGKILL/);
  });

  it('passes env and cwd to spawn', async () => {
    mockSpawn.mockReturnValue(fakeChild(0, 'ok'));
    await spawnCli('cmd', ['a'], {
      timeoutMs: 5000,
      env: { FOO: '1', PATH: '/usr/bin' },
      cwd: '/tmp',
    });
    expect(mockSpawn).toHaveBeenCalledWith('cmd', ['a'], expect.objectContaining({
      env: { FOO: '1', PATH: '/usr/bin' },
      cwd: '/tmp',
    }));
  });

  it('defaults env to process.env when not provided', async () => {
    mockSpawn.mockReturnValue(fakeChild(0, 'ok'));
    await spawnCli('cmd', [], { timeoutMs: 5000 });
    expect(mockSpawn).toHaveBeenCalledWith('cmd', [], expect.objectContaining({
      env: process.env,
    }));
  });

  it('uses command name as default label in error messages', async () => {
    mockSpawn.mockReturnValue(fakeChild(1, '', ''));
    await expect(spawnCli('mybin', [], { timeoutMs: 5000 }))
      .rejects.toThrow(/mybin exited with code 1/);
  });

  it('spawns with stdio ignore/pipe/pipe', async () => {
    mockSpawn.mockReturnValue(fakeChild(0, 'ok'));
    await spawnCli('cmd', [], { timeoutMs: 5000 });
    expect(mockSpawn).toHaveBeenCalledWith('cmd', [], expect.objectContaining({
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  });

  it('rejects with BackendError when spawn emits error (e.g. ENOENT)', async () => {
    const child = new EventEmitter() as ChildProcess;
    (child as any).stdout = new PassThrough();
    (child as any).stderr = new PassThrough();
    (child as any).killed = false;
    (child as any).kill = vi.fn();
    mockSpawn.mockReturnValue(child);
    process.nextTick(() => child.emit('error', new Error('spawn ENOENT')));

    const err = await spawnCli('missing', [], { timeoutMs: 5000 }).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.message).toContain('failed to start');
    expect(err.message).toContain('ENOENT');
  });
});

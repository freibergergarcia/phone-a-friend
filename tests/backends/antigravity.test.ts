import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { SandboxMode } from '../../src/backends/index.js';

const { mockExecFileSync, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync, spawn: mockSpawn };
});

import {
  ANTIGRAVITY_BACKEND,
  AntigravityBackendError,
  antigravityTimeoutRemediation,
  buildAntigravityArgs,
} from '../../src/backends/antigravity.js';

function fakeChild(exitCode = 0, stdout = '', stderr = '') {
  const child = new EventEmitter();
  (child as any).stdout = new PassThrough();
  (child as any).stderr = new PassThrough();
  (child as any).killed = false;
  (child as any).kill = vi.fn();
  process.nextTick(() => {
    if (stdout) (child as any).stdout.write(stdout);
    (child as any).stdout.end();
    if (stderr) (child as any).stderr.write(stderr);
    (child as any).stderr.end();
    child.emit('close', exitCode, null);
  });
  return child;
}

describe('AntigravityBackend', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('declares phase-one capabilities', () => {
    expect(ANTIGRAVITY_BACKEND.name).toBe('antigravity');
    expect(ANTIGRAVITY_BACKEND.localFileAccess).toBe(true);
    expect(ANTIGRAVITY_BACKEND.allowedSandboxes.has('read-only')).toBe(true);
    expect(ANTIGRAVITY_BACKEND.allowedSandboxes.has('workspace-write')).toBe(false);
    expect(ANTIGRAVITY_BACKEND.allowedSandboxes.has('danger-full-access')).toBe(false);
    expect(ANTIGRAVITY_BACKEND.capabilities).toEqual({
      resumeStrategy: 'unsupported',
      requiresClientSessionId: false,
    });
  });

  it('builds read-only agy print-mode args', () => {
    const args = buildAntigravityArgs({
      prompt: 'Review this.',
      repoPath: '/repo',
      sandbox: 'read-only',
      model: null,
      timeoutSeconds: 60,
    });

    expect(args).toEqual([
      '--add-dir',
      '/repo',
      '--print-timeout',
      '60s',
      '--sandbox',
      '--mode',
      'plan',
      '--prompt',
      'Review this.',
    ]);
  });

  it('forwards Antigravity display model names unchanged', () => {
    const args = buildAntigravityArgs({
      prompt: 'Review this.',
      repoPath: '/repo',
      sandbox: 'read-only',
      model: 'Gemini 3.5 Flash (Medium)',
      timeoutSeconds: 60,
    });

    expect(args).toEqual(expect.arrayContaining([
      '--model',
      'Gemini 3.5 Flash (Medium)',
    ]));
  });

  it('rejects unproven write sandboxes directly from the builder', () => {
    expect(() => buildAntigravityArgs({
      prompt: 'x',
      repoPath: '/repo',
      sandbox: 'workspace-write',
      model: null,
      timeoutSeconds: 60,
    })).toThrow(AntigravityBackendError);
  });

  it('checks for the agy executable using backend env and runs with cwd set to repo path', async () => {
    let capturedWhichOpts: Record<string, unknown> = {};
    mockExecFileSync.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
      capturedWhichOpts = opts;
      if (cmd === 'which' && args[0] === 'agy') return '/usr/local/bin/agy';
      throw new Error(`unexpected execFileSync call: ${cmd} ${args.join(' ')}`);
    });

    let capturedCommand = '';
    let capturedArgs: string[] = [];
    let capturedOpts: Record<string, unknown> = {};
    mockSpawn.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
      capturedCommand = cmd;
      capturedArgs = args;
      capturedOpts = opts;
      return fakeChild(0, 'Antigravity feedback');
    });

    const result = await ANTIGRAVITY_BACKEND.run({
      prompt: 'Review implementation.',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: { PATH: '/custom/bin' },
    });

    expect(result).toBe('Antigravity feedback');
    expect(capturedWhichOpts.env).toEqual({ PATH: '/custom/bin' });
    expect(capturedCommand).toBe('agy');
    expect(capturedArgs).toEqual(expect.arrayContaining([
      '--add-dir',
      '/tmp/repo',
      '--print-timeout',
      '60s',
      '--sandbox',
      '--mode',
      'plan',
      '--prompt',
      'Review implementation.',
    ]));
    expect(capturedOpts.cwd).toBe('/tmp/repo');
  });

  it('adds a grace buffer and preserves Codex timeout remediation end to end', async () => {
    vi.useFakeTimers();
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    const child = new EventEmitter();
    (child as any).stdout = new PassThrough();
    (child as any).stderr = new PassThrough();
    (child as any).kill = vi.fn(() => {
      child.emit('close', null, 'SIGTERM');
    });

    mockSpawn.mockReturnValue(child);

    const promise = ANTIGRAVITY_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: { PHONE_A_FRIEND_HOST: 'codex' },
    });
    const rejection = promise.catch((err) => err);

    await vi.advanceTimersByTimeAsync(74_000);
    expect((child as any).kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    const err = await rejection;
    expect(err).toBeInstanceOf(AntigravityBackendError);
    expect(err.message).toContain('antigravity timed out after 75s');
    expect(err.message).toContain('danger-full-access');
  });

  it('injects schema instructions as best-effort prompt text', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild(0, '{"ok":true}');
    });

    await ANTIGRAVITY_BACKEND.run({
      prompt: 'Return status.',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: {},
      schema: '{"type":"object"}',
    });

    const prompt = capturedArgs[capturedArgs.indexOf('--prompt') + 1];
    expect(prompt).toContain('Return status.');
    expect(prompt).toContain('Respond with JSON only.');
    expect(prompt).toContain('{"type":"object"}');
  });

  it('errors when agy is missing', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    await expect(ANTIGRAVITY_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: {},
    })).rejects.toThrow('Antigravity CLI not found in PATH');
  });

  it('errors on empty output', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, ''));

    await expect(ANTIGRAVITY_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: {},
    })).rejects.toThrow('antigravity completed without producing output');
  });

  it('preserves non-zero exit details from agy', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(2, 'partial stdout', 'auth failed'));

    await expect(ANTIGRAVITY_BACKEND.run({
      prompt: 'x',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: {},
    })).rejects.toThrow(/Antigravity exited with code 2\.[\s\S]*stderr: auth failed[\s\S]*stdout: partial stdout/);
  });

  it('surfaces Codex sandbox-aware timeout remediation', () => {
    expect(antigravityTimeoutRemediation('codex')).toContain('Codex');
    expect(antigravityTimeoutRemediation('codex')).toContain('danger-full-access');
  });

  it('does not read Codex host remediation from process env when host is omitted', () => {
    const previous = process.env.PHONE_A_FRIEND_HOST;
    process.env.PHONE_A_FRIEND_HOST = 'codex';
    try {
      expect(antigravityTimeoutRemediation('')).not.toContain('Codex');
    } finally {
      if (previous === undefined) {
        delete process.env.PHONE_A_FRIEND_HOST;
      } else {
        process.env.PHONE_A_FRIEND_HOST = previous;
      }
    }
  });
});

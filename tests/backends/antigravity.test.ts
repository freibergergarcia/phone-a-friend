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

  it('declares native session capabilities', () => {
    expect(ANTIGRAVITY_BACKEND.name).toBe('antigravity');
    expect(ANTIGRAVITY_BACKEND.localFileAccess).toBe(true);
    expect(ANTIGRAVITY_BACKEND.allowedSandboxes.has('read-only')).toBe(true);
    expect(ANTIGRAVITY_BACKEND.allowedSandboxes.has('workspace-write')).toBe(false);
    expect(ANTIGRAVITY_BACKEND.allowedSandboxes.has('danger-full-access')).toBe(false);
    expect(ANTIGRAVITY_BACKEND.capabilities).toEqual({
      resumeStrategy: 'native-session',
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

  it.each([false, true])('builds session args with resume=%s', (resumeSession) => {
    expect(buildAntigravityArgs({
      prompt: 'Follow up.', repoPath: '/repo', sandbox: 'read-only',
      model: null, timeoutSeconds: 60, persistSession: !resumeSession,
      resumeSession, sessionId: resumeSession ? 'agy-thread' : null,
    })).toEqual([
      '--add-dir', '/repo', '--print-timeout', '60s', '--sandbox', '--mode', 'plan',
      '--output-format', 'json',
      ...(resumeSession ? ['--conversation', 'agy-thread'] : []),
      '--prompt', 'Follow up.',
    ]);
  });

  it.each([false, true])('returns the response and emits the session ID with resume=%s', async (resumeSession) => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify({
      conversation_id: 'agy-thread', status: 'SUCCESS', response: 'noted.\n',
    })));
    const onSessionCreated = vi.fn();
    const result = await ANTIGRAVITY_BACKEND.run({
      prompt: 'Remember this.', repoPath: '/repo', sandbox: 'read-only',
      model: null, timeoutSeconds: 60, env: {}, persistSession: !resumeSession,
      resumeSession, sessionId: resumeSession ? 'agy-thread' : null, onSessionCreated,
    });
    expect(result).toBe('noted.\n');
    expect(onSessionCreated).toHaveBeenCalledExactlyOnceWith('agy-thread');
    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--output-format');
    expect(args.includes('--conversation')).toBe(resumeSession);
    expect(args.slice(-2)).toEqual(['--prompt', 'Remember this.']);
  });

  it.each([
    ['not JSON', 'invalid session JSON'],
    [JSON.stringify({ status: 'ERROR', response: 'failed' }), 'status: ERROR: failed'],
    ['null', 'status: missing'],
    [JSON.stringify({ status: 'SUCCESS', response: '' }), 'without producing a response'],
    [JSON.stringify({ status: 'SUCCESS', response: '   ' }), 'without producing a response'],
    [JSON.stringify({ status: 'SUCCESS' }), 'without producing a response'],
    [JSON.stringify({ status: 'ERROR', error: 'quota exceeded' }), 'status: ERROR: quota exceeded'],
    [JSON.stringify({ status: 'SUCCESS', response: 'ok' }), 'without a conversation_id'],
    [JSON.stringify({ status: 'SUCCESS', response: 'ok', conversation_id: ' ' }), 'without a conversation_id'],
  ])('rejects invalid session output %s', async (stdout, message) => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, stdout));
    const onSessionCreated = vi.fn();
    const error = await ANTIGRAVITY_BACKEND.run({
      prompt: 'x', repoPath: '/repo', sandbox: 'read-only', model: null,
      timeoutSeconds: 60, env: {}, persistSession: true, onSessionCreated,
    }).catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityBackendError);
    expect(error.message).toContain(message);
    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
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

  it('refuses a resume that started a new conversation', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify({
      conversation_id: 'fresh-thread', status: 'SUCCESS', response: 'OK\n',
    }), 'warning: conversation "agy-thread" not found\n'));
    const onSessionCreated = vi.fn();
    const error = await ANTIGRAVITY_BACKEND.run({
      prompt: 'x', repoPath: '/repo', sandbox: 'read-only', model: null,
      timeoutSeconds: 60, env: {}, resumeSession: true, sessionId: 'agy-thread', onSessionCreated,
    }).catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityBackendError);
    expect(error.message).toContain('did not resume conversation agy-thread');
    expect(error.message).toContain('conversation "agy-thread" not found');
    expect(onSessionCreated).not.toHaveBeenCalled();
  });

  it.each([
    [false, ''],
    [true, JSON.stringify({ conversation_id: 'agy-thread', status: 'SUCCESS', response: '' })],
  ])('reports agy print timeouts with stderr and remediation (session=%s)', async (persistSession, stdout) => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, stdout,
      '[agy] print timeout after 3s with turn in progress; returning partial output\n'));
    const error = await ANTIGRAVITY_BACKEND.run({
      prompt: 'x', repoPath: '/repo', sandbox: 'read-only', model: null,
      timeoutSeconds: 3, env: { PHONE_A_FRIEND_HOST: 'codex' }, persistSession,
    }).catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityBackendError);
    expect(error.message).toContain('stderr: [agy] print timeout after 3s');
    expect(error.message).toContain('danger-full-access');
  });

  it.each([
    [false, 'Unix began in 1969 at Bell Lab'],
    [true, JSON.stringify({ conversation_id: 'agy-thread', status: 'SUCCESS', response: 'Unix began in 1969 at Bell Lab' })],
  ])('rejects partial output cut off by the agy print timeout (session=%s)', async (persistSession, stdout) => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, stdout,
      '[agy] print timeout after 3s with turn in progress; returning partial output\n'));
    const onSessionCreated = vi.fn();
    const error = await ANTIGRAVITY_BACKEND.run({
      prompt: 'x', repoPath: '/repo', sandbox: 'read-only', model: null,
      timeoutSeconds: 3, env: {}, persistSession, onSessionCreated,
    }).catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityBackendError);
    expect(error.message).toContain('returned partial output; raise --timeout');
    expect(error.message).toContain('stderr: [agy] print timeout after 3s');
    expect(error.message).toContain('Antigravity timed out.');
    expect(error.message).toMatch(/partial output:\nUnix began in 1969 at Bell Lab$/);
    expect(onSessionCreated).not.toHaveBeenCalled();
  });

  it('keeps only the tail of long stderr in errors', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, '', `${'x'.repeat(5000)}END`));
    const error = await ANTIGRAVITY_BACKEND.run({
      prompt: 'x', repoPath: '/repo', sandbox: 'read-only', model: null,
      timeoutSeconds: 60, env: {},
    }).catch((err) => err);
    const stderr = error.message.split('stderr: ')[1];
    expect(stderr).toMatch(/^…x+END$/);
    expect(stderr.length).toBe(2049);
  });

  it('appends stderr to empty output without timeout remediation', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    mockSpawn.mockImplementation(() => fakeChild(0, '', 'something odd\n'));
    const error = await ANTIGRAVITY_BACKEND.run({
      prompt: 'x', repoPath: '/repo', sandbox: 'read-only', model: null,
      timeoutSeconds: 60, env: {},
    }).catch((err) => err);
    expect(error.message).toBe('antigravity completed without producing output\nstderr: something odd');
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

  it('enforces a schema natively instead of injecting it into the prompt', async () => {
    // agy has had --json-schema since 1.1.8; the envelope carries the clean
    // value under structured_output (see antigravity-schema.test.ts).
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild(0, JSON.stringify({ status: 'SUCCESS', response: '{"ok":true}', structured_output: { ok: true } }));
    });

    const result = await ANTIGRAVITY_BACKEND.run({
      prompt: 'Return status.',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only',
      model: null,
      env: {},
      schema: '{"type":"object"}',
    });

    expect(result).toBe('{"ok":true}');
    const prompt = capturedArgs[capturedArgs.indexOf('--prompt') + 1];
    expect(prompt).toBe('Return status.');
    expect(capturedArgs).toContain('--json-schema');
    expect(capturedArgs[capturedArgs.indexOf('--json-schema') + 1]).toBe('{"type":"object"}');
    expect(capturedArgs).toContain('--output-format');
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

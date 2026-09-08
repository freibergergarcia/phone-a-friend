import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { dirname } from 'node:path';
import type { SandboxMode } from '../../src/backends/index.js';

// vi.hoisted runs before vi.mock hoisting — safe to reference in factory
const { mockExecFileSync, mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync, execFile: mockExecFile, spawn: mockSpawn };
});

// Import AFTER mock is set up
import { CODEX_BACKEND, CodexBackendError, isCodexHostEnv } from '../../src/backends/codex.js';
import type { ReviewOptions, SandboxMode as SandboxModeType } from '../../src/backends/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodexBackend', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFile.mockReset();
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and allowed sandboxes', () => {
    expect(CODEX_BACKEND.name).toBe('codex');
    expect(CODEX_BACKEND.allowedSandboxes.has('read-only')).toBe(true);
    expect(CODEX_BACKEND.allowedSandboxes.has('workspace-write')).toBe(true);
    expect(CODEX_BACKEND.allowedSandboxes.has('danger-full-access')).toBe(true);
  });

  it('detects Codex host marker env', () => {
    expect(isCodexHostEnv({ PHONE_A_FRIEND_HOST: 'codex' })).toBe(true);
    expect(isCodexHostEnv({ PHONE_A_FRIEND_HOST: 'opencode' })).toBe(false);
    expect(isCodexHostEnv({ PHONE_A_FRIEND_HOST: 'claude' })).toBe(false);
    expect(isCodexHostEnv({})).toBe(false);
  });

  it('does not block on bare CODEX_* env vars (false-positive vector)', () => {
    // CODEX_HOME and friends are user-shell exports; only PHONE_A_FRIEND_HOST
    // should trigger the recursion guard.
    expect(isCodexHostEnv({ CODEX_HOME: '/tmp/codex' })).toBe(false);
    expect(isCodexHostEnv({ CODEX_API_KEY: 'sk-xyz' })).toBe(false);
  });

  it('blocks recursive Codex backend calls when Codex is the host', async () => {
    await expect(CODEX_BACKEND.run({
      prompt: 'hi',
      repoPath: '/tmp/repo',
      timeoutSeconds: 30,
      sandbox: 'read-only' as SandboxModeType,
      model: null,
      env: { PHONE_A_FRIEND_HOST: 'codex' },
    })).rejects.toThrow(/Codex is already the host/);
  });

  it('blocks recursive Codex review calls when Codex is the host', async () => {
    await expect(CODEX_BACKEND.review!({
      repoPath: '/tmp/repo',
      timeoutSeconds: 30,
      sandbox: 'read-only' as SandboxModeType,
      model: null,
      env: { PHONE_A_FRIEND_HOST: 'codex' },
      base: 'main',
    } as ReviewOptions)).rejects.toThrow(/Codex is already the host/);
  });

  it('builds correct codex exec args', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'Codex feedback');
        child.emit('close', 0, null);
      });
      return child;
    });

    const result = await CODEX_BACKEND.run({
      prompt: 'Review this code',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('Codex feedback');

    // Find the codex call in mockSpawn
    const codexCall = mockSpawn.mock.calls.find(
      (c: unknown[]) => c[0] === 'codex',
    );
    expect(codexCall).toBeDefined();
    const args = codexCall![1] as string[];
    expect(args[0]).toBe('exec');
    expect(args).toContain('-C');
    expect(args).toContain('/tmp/repo');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
    expect(args).toContain('--output-last-message');
    // Prompt is the last arg
    expect(args[args.length - 1]).toContain('Review this code');
  });

  it('passes -m when model is provided', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
        child.emit('close', 0, null);
      });
      return child;
    });

    await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: 'o3',
      env: {},
    });

    const codexCall = mockSpawn.mock.calls.find(
      (c: unknown[]) => c[0] === 'codex',
    );
    const args = codexCall![1] as string[];
    const modelIdx = args.indexOf('-m');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('o3');
  });

  it('does not pass -m when model is null', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
        child.emit('close', 0, null);
      });
      return child;
    });

    await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    const codexCall = mockSpawn.mock.calls.find(
      (c: unknown[]) => c[0] === 'codex',
    );
    const args = codexCall![1] as string[];
    expect(args).not.toContain('-m');
  });

  it('reads result from temp output file', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'File-based output');
        child.emit('close', 0, null);
      });
      return child;
    });

    const result = await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('File-based output');
  });

  it('falls back to stdout when output file is missing', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation(() => {
      const child = fakeChild();
      process.nextTick(() => {
        // Don't write output file — push stdout data instead
        child.stdout.push(Buffer.from('stdout feedback'));
        child.stdout.push(null);
        child.emit('close', 0, null);
      });
      return child;
    });

    const result = await CODEX_BACKEND.run({
      prompt: 'Review',
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null,
      env: {},
    });

    expect(result).toBe('stdout feedback');
  });

  it('throws CodexBackendError when codex not found in PATH', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') throw new Error('not found');
      return '';
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/codex CLI not found/);
  });

  it('throws on non-zero exit code with stderr', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation(() => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stderr.push(Buffer.from('codex failed'));
        child.stderr.push(null);
        child.stdout.push(null);
        child.emit('close', 2, null);
      });
      return child;
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow('codex failed');
  });

  it('throws on timeout', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation(() => {
      const child = fakeChild();
      // Don't emit close — let spawnCli's timeout fire, then kill triggers close
      child.kill = vi.fn(() => {
        child.emit('close', null, 'SIGTERM');
      });
      return child;
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 0.01,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('throws when codex produces no output', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation(() => {
      const child = fakeChild();
      process.nextTick(() => {
        // No output file, no stdout
        child.emit('close', 0, null);
      });
      return child;
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/without producing feedback/);
  });

  it('throws on output file read failure (OSError parity)', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/codex';
      return '';
    });

    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        // Write a directory where the output file should be, causing read failure
        if (outputIdx > 0) {
          fs.mkdirSync(args[outputIdx], { recursive: true });
        }
        child.emit('close', 0, null);
      });
      return child;
    });

    await expect(
      CODEX_BACKEND.run({
        prompt: 'Review',
        repoPath: '/tmp/repo',
        timeoutSeconds: 60,
        sandbox: 'read-only' as SandboxMode,
        model: null,
        env: {},
      }),
    ).rejects.toThrow(/Failed reading Codex output file/);
  });

  describe('structured output and sessions', () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: { verdict: { type: 'string', enum: ['ship', 'iterate'] } },
      required: ['verdict'],
      additionalProperties: false,
    });
    const opts = {
      prompt: 'Give a verdict', repoPath: '/tmp/repo', timeoutSeconds: 60,
      sandbox: 'read-only' as const, model: 'test-model', env: { PATH: '/selected/bin' },
      schema, sessionId: 'thread-123', resumeSession: true, persistSession: true,
    };
    let schemaPath: string;

    beforeEach(() => {
      schemaPath = '';
      mockExecFileSync.mockReturnValue('/selected/bin/codex');
      mockExecFile.mockImplementation((_cmd, _args, _options, cb) => {
        cb(null, 'Options:\n      --output-schema <FILE>\n      --json', '');
      });
      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const child = fakeChild();
        const schemaIdx = args.indexOf('--output-schema');
        if (schemaIdx >= 0) {
          schemaPath = args[schemaIdx + 1];
          expect(fs.readFileSync(schemaPath, 'utf8')).toBe(schema);
        }
        const outputIdx = args.indexOf('-o') >= 0
          ? args.indexOf('-o') + 1 : args.indexOf('--output-last-message') + 1;
        process.nextTick(() => {
          fs.writeFileSync(args[outputIdx], '{"verdict":"ship"}');
          child.stdout.end('{"type":"thread.started","thread_id":"thread-123"}\n');
          child.emit('close', 0, null);
        });
        return child;
      });
    });

    it.each([
      { name: 'initial ephemeral call', resumeSession: false, persistSession: false, sessionId: null },
      { name: 'initial managed session', resumeSession: false, persistSession: true, sessionId: null },
      { name: 'managed resume', resumeSession: true, persistSession: true, sessionId: 'thread-123' },
      { name: 'raw thread attachment', resumeSession: true, persistSession: false, sessionId: 'thread-123' },
    ])('forwards schema for $name, preserves output/thread capture, and cleans up', async (session) => {
      const onSessionCreated = vi.fn();
      expect(await CODEX_BACKEND.run({ ...opts, ...session, onSessionCreated }))
        .toBe('{"verdict":"ship"}');
      expect(onSessionCreated).toHaveBeenCalledWith('thread-123');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [command, args, spawnOpts] = mockSpawn.mock.calls[0];
      expect(command).toBe('codex');
      expect(args).toContain('--output-schema');
      expect(args.filter((arg: string) => arg === '--json')).toHaveLength(1);
      expect(args.slice(-3)).toEqual(['-m', 'test-model', opts.prompt]);
      expect(args.includes('--ephemeral')).toBe(!session.resumeSession && !session.persistSession);
      if (session.resumeSession) {
        expect(args.slice(0, 3)).toEqual(['exec', 'resume', session.sessionId]);
        expect(args).not.toContain('-C');
        expect(args).not.toContain('--sandbox');
        expect(mockExecFile).toHaveBeenCalledWith('codex', ['exec', 'resume', '--help'],
          expect.objectContaining({ env: spawnOpts.env, timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 131072 }),
          expect.any(Function));
      } else {
        expect(args).toContain('-C');
        expect(args).toContain('--sandbox');
        expect(mockExecFile).not.toHaveBeenCalled();
      }
      expect(mockExecFileSync).toHaveBeenCalledWith('which', ['codex'],
        expect.objectContaining({ env: opts.env }));
      expect(fs.existsSync(schemaPath)).toBe(false);
      expect(fs.existsSync(dirname(schemaPath))).toBe(false);
    });

    it.each([
      ['older help', 'Options:\n      --json\n      --ephemeral'],
      ['empty help', ''],
      ['unrelated prose', 'Use --output-schema on exec, but not on resume.'],
      ['different flag', '      --output-schema-version <VERSION>'],
    ])('rejects %s without starting model work or allocating schema files', async (_name, help) => {
      mockExecFile.mockImplementation((_cmd, _args, _options, cb) => cb(null, help, ''));
      await expect(CODEX_BACKEND.run(opts)).rejects.toThrow(/does not advertise --output-schema/);
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(schemaPath).toBe('');
    });

    it.each(['nonzero exit', 'ENOENT', 'timeout', 'maxBuffer exceeded'])(
      'rejects a failed capability probe (%s) without starting model work', async (message) => {
        mockExecFile.mockImplementation((_cmd, _args, _options, cb) =>
          cb(new Error(message), '      --output-schema <FILE>', 'private stderr'));
        await expect(CODEX_BACKEND.run(opts)).rejects.toThrow(/Could not verify Codex resume schema support/);
        expect(mockSpawn).not.toHaveBeenCalled();
      });

    it('caps the help probe by a shorter caller timeout', async () => {
      await CODEX_BACKEND.run({ ...opts, timeoutSeconds: 0.5 });
      expect(mockExecFile.mock.calls[0][2].timeout).toBe(500);
    });

    it('does not probe or add a schema for a plain resume on an older executable', async () => {
      await CODEX_BACKEND.run({ ...opts, schema: undefined });
      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockSpawn.mock.calls[0][1]).not.toContain('--output-schema');
      expect(mockSpawn.mock.calls[0][1].slice(0, 3)).toEqual(['exec', 'resume', 'thread-123']);
    });

    it('does not reuse a capability result for another invocation environment', async () => {
      await CODEX_BACKEND.run(opts);
      mockExecFile.mockImplementation((_cmd, _args, _options, cb) => cb(null, '      --json', ''));
      await expect(CODEX_BACKEND.run({ ...opts, env: { PATH: '/older/bin' } }))
        .rejects.toThrow(/does not advertise/);
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile.mock.calls[1][2].env.PATH).toBe('/older/bin');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('snapshots the invocation environment across the asynchronous probe and execution', async () => {
      const env = { PATH: '/selected/bin' };
      mockExecFile.mockImplementation((_cmd, _args, _options, cb) => {
        env.PATH = '/changed/bin';
        cb(null, '      --output-schema <FILE>', '');
      });
      await CODEX_BACKEND.run({ ...opts, env });
      expect(mockSpawn.mock.calls[0][2].env.PATH).toBe('/selected/bin');
    });

    it.each([false, true])('cleans up schema files on exec failure (partial output: %s)', async (partial) => {
      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const child = fakeChild();
        schemaPath = args[args.indexOf('--output-schema') + 1];
        expect(fs.readFileSync(schemaPath, 'utf8')).toBe(schema);
        process.nextTick(() => {
          if (partial) fs.writeFileSync(args[args.indexOf('-o') + 1], '{"verdict":"iterate"}');
          child.stdout.end('{"type":"thread.started","thread_id":"partial-thread"}\n');
          child.stderr.end('exec failed');
          child.emit('close', 1, null);
        });
        return child;
      });
      const onSessionCreated = vi.fn();
      const result = CODEX_BACKEND.run({ ...opts, onSessionCreated });
      if (partial) await expect(result).resolves.toBe('{"verdict":"iterate"}');
      else await expect(result).rejects.toThrow('exec failed');
      expect(onSessionCreated).toHaveBeenCalledWith('partial-thread');
      expect(fs.existsSync(schemaPath)).toBe(false);
      expect(fs.existsSync(dirname(schemaPath))).toBe(false);
    });
  });

  // --- review() method ---

  describe('review()', () => {
    const baseReviewOpts: ReviewOptions = {
      repoPath: '/tmp/repo',
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxModeType,
      model: null,
      env: {},
      base: 'main',
    };

    it('builds correct codex exec review --base main args', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        return '';
      });

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const child = fakeChild();
        const outputIdx = args.indexOf('--output-last-message') + 1;
        process.nextTick(() => {
          if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'Review feedback');
          child.emit('close', 0, null);
        });
        return child;
      });

      const result = await CODEX_BACKEND.review!(baseReviewOpts);
      expect(result).toBe('Review feedback');

      const codexCall = mockSpawn.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      expect(codexCall).toBeDefined();
      const args = codexCall![1] as string[];
      expect(args[0]).toBe('exec');
      expect(args[1]).toBe('review');
      // codex exec review does not accept -C or --sandbox; uses cwd instead
      expect(args).not.toContain('-C');
      expect(args).not.toContain('--sandbox');
      expect(args).toContain('--base');
      expect(args[args.indexOf('--base') + 1]).toBe('main');
      expect(args).toContain('--output-last-message');
      expect(args).toContain('--skip-git-repo-check');
      // cwd should be set to repoPath
      const spawnOpts = codexCall![2] as Record<string, unknown>;
      expect(spawnOpts.cwd).toBe('/tmp/repo');
    });

    it('maps working-tree review scope to codex exec review --uncommitted', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        return '';
      });

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const child = fakeChild();
        const outputIdx = args.indexOf('--output-last-message') + 1;
        process.nextTick(() => {
          if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'Review feedback');
          child.emit('close', 0, null);
        });
        return child;
      });

      await CODEX_BACKEND.review!({
        ...baseReviewOpts,
        scope: 'working-tree',
      });

      const codexCall = mockSpawn.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      const args = codexCall![1] as string[];
      expect(args).toContain('--uncommitted');
      expect(args).not.toContain('--base');
    });

    it('drops custom prompt when --base is present (mutually exclusive in codex exec review)', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        return '';
      });

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const child = fakeChild();
        const outputIdx = args.indexOf('--output-last-message') + 1;
        process.nextTick(() => {
          if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
          child.emit('close', 0, null);
        });
        return child;
      });

      await CODEX_BACKEND.review!({
        ...baseReviewOpts,
        prompt: 'Focus on security issues',
      });

      const codexCall = mockSpawn.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      const args = codexCall![1] as string[];
      // Prompt is dropped because --base and [PROMPT] are mutually exclusive
      expect(args).not.toContain('Focus on security issues');
      expect(args).toContain('--base');
    });

    it('passes -m when model is set', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        return '';
      });

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const child = fakeChild();
        const outputIdx = args.indexOf('--output-last-message') + 1;
        process.nextTick(() => {
          if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
          child.emit('close', 0, null);
        });
        return child;
      });

      await CODEX_BACKEND.review!({ ...baseReviewOpts, model: 'o3' });

      const codexCall = mockSpawn.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      const args = codexCall![1] as string[];
      const modelIdx = args.indexOf('-m');
      expect(modelIdx).toBeGreaterThan(-1);
      expect(args[modelIdx + 1]).toBe('o3');
    });

    it('throws on timeout', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        return '';
      });

      mockSpawn.mockImplementation(() => {
        const child = fakeChild();
        child.kill = vi.fn(() => {
          child.emit('close', null, 'SIGTERM');
        });
        return child;
      });

      await expect(
        CODEX_BACKEND.review!({ ...baseReviewOpts, timeoutSeconds: 0.01 }),
      ).rejects.toThrow(/codex exec review timed out/);
    });

    it('throws when codex not found in PATH', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') throw new Error('not found');
        return '';
      });

      await expect(
        CODEX_BACKEND.review!(baseReviewOpts),
      ).rejects.toThrow(/codex CLI not found/);
    });

    it('does not include prompt arg when prompt is undefined', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/codex';
        return '';
      });

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const child = fakeChild();
        const outputIdx = args.indexOf('--output-last-message') + 1;
        process.nextTick(() => {
          if (outputIdx > 0) fs.writeFileSync(args[outputIdx], 'ok');
          child.emit('close', 0, null);
        });
        return child;
      });

      await CODEX_BACKEND.review!(baseReviewOpts);

      const codexCall = mockSpawn.mock.calls.find(
        (c: unknown[]) => c[0] === 'codex',
      );
      const args = codexCall![1] as string[];
      // Last arg should be the output path value, not a prompt
      expect(args[args.length - 1]).not.toBe('main'); // base value
      // The args should not contain any extra positional arg beyond flags
      const outputIdx = args.indexOf('--output-last-message');
      expect(outputIdx).toBeGreaterThan(-1);
    });
  });
});

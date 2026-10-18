import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxMode } from '../../src/backends/index.js';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mockSpawn };
});

import { BACKEND_COMMANDS, INSTALL_HINTS, getBackend } from '../../src/backends/index.js';
import {
  GROK_BACKEND,
  GROK_SCHEMA_UNSUPPORTED,
  GrokBackendError,
  buildGrokArgs,
  isGrokHostEnv,
  parseGrokResult,
} from '../../src/backends/grok.js';
import { RelayError, relay } from '../../src/relay.js';
import { run } from '../../src/cli.js';

function envelope(text: string, stopReason = 'stop', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ text, stopReason, sessionId: '01a14fbf-0000-7000-8000-000000000001', ...extra });
}

/** Values that follow one flag, in order. `--allow Bash` and `--deny Bash` are different. */
function flagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag) values.push(args[i + 1]);
  }
  return values;
}

function mockChild(stdout: string, exitCode = 0, opts: { stderr?: string } = {}) {
  const stdoutStream = Readable.from(stdout ? [Buffer.from(stdout)] : []);
  const stderrStream = Readable.from(opts.stderr ? [Buffer.from(opts.stderr)] : []);
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.killed = false;
  child.kill = vi.fn(() => { child.killed = true; });
  stdoutStream.on('end', () => {
    process.nextTick(() => child.emit('close', exitCode, null));
  });
  return child;
}

describe('grok backend', () => {
  let root: string;
  let repo: string;
  let bin: string;

  function makeOpts(overrides: Record<string, unknown> = {}) {
    return {
      prompt: 'What is 1+1? Reply with the number only.',
      repoPath: repo,
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null as string | null,
      env: { PATH: `${bin}:/usr/bin:/bin` } as Record<string, string>,
      ...overrides,
    };
  }

  /** Spawn that records the prompt file contents, then returns a successful envelope. */
  function spawnOk(text = '2.') {
    let promptPath = '';
    let promptBody = '';
    mockSpawn.mockImplementation((_command: string, args: string[]) => {
      promptPath = args[args.indexOf('--prompt-file') + 1];
      promptBody = readFileSync(promptPath, 'utf8');
      return mockChild(envelope(text));
    });
    return {
      promptPath: () => promptPath,
      promptBody: () => promptBody,
    };
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'paf-grok-')));
    repo = join(root, 'repo');
    bin = join(root, 'bin');
    mkdirSync(repo);
    mkdirSync(bin);
    writeFileSync(join(bin, 'grok'), '#!/bin/sh\n', { mode: 0o755 });
    mockSpawn.mockReset();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('registration', () => {
    it('registers as "grok" with local file access, every sandbox, and no resume', () => {
      const backend = getBackend('grok');
      expect(backend).toBe(GROK_BACKEND);
      expect(backend.localFileAccess).toBe(true);
      expect([...backend.allowedSandboxes].sort()).toEqual([
        'danger-full-access',
        'read-only',
        'workspace-write',
      ]);
      expect(backend.capabilities).toEqual({
        resumeStrategy: 'unsupported',
        requiresClientSessionId: false,
      });
      expect(backend.review).toBeUndefined();
      expect(backend.runStream).toBeUndefined();
    });

    it('declares its executable and install hint', () => {
      expect(BACKEND_COMMANDS.grok).toBe('grok');
      expect(INSTALL_HINTS.grok).toBe('npm install -g @xai-official/grok');
    });
  });

  describe('run()', () => {
    it('spawns grok read-only, returns the answer text, and removes the prompt file', async () => {
      const spawned = spawnOk();
      const opts = makeOpts();

      await expect(GROK_BACKEND.run(opts)).resolves.toBe('2.');

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [command, args, spawnOpts] = mockSpawn.mock.calls[0];
      expect(command).toBe('grok');
      expect(args).toEqual(buildGrokArgs({
        promptFile: spawned.promptPath(),
        repoPath: repo,
        sandbox: 'read-only',
        model: null,
      }));
      expect(args).toContain('--no-auto-update');
      expect(flagValues(args, '--allow')).toEqual(['Read', 'Grep']);
      expect(flagValues(args, '--deny')).toEqual(['Bash']);
      expect(args).not.toContain('--always-approve');
      expect(spawnOpts.cwd).toBe(repo);
      expect(spawnOpts.env).toBe(opts.env);
      expect(spawned.promptBody()).toBe(opts.prompt);
      expect(existsSync(spawned.promptPath())).toBe(false);
    });

    it('maps workspace-write to edit and write, and danger-full-access to bypass', async () => {
      spawnOk();
      await GROK_BACKEND.run(makeOpts({ sandbox: 'workspace-write' }));
      const writeArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(writeArgs).toEqual(expect.arrayContaining([
        '--sandbox', 'workspace',
        '--permission-mode', 'dontAsk',
        '--allow', 'Edit',
      ]));
      expect(flagValues(writeArgs, '--allow')).toEqual(['Read', 'Grep', 'Edit']);
      expect(flagValues(writeArgs, '--allow')).not.toContain('Write');
      expect(flagValues(writeArgs, '--deny')).toEqual(['Bash']);
      expect(writeArgs).not.toContain('--always-approve');

      mockSpawn.mockReset();
      spawnOk();
      await GROK_BACKEND.run(makeOpts({ sandbox: 'danger-full-access' }));
      const dangerArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(dangerArgs).toEqual(expect.arrayContaining([
        '--sandbox', 'off',
        '--permission-mode', 'bypassPermissions',
      ]));
      expect(dangerArgs).not.toContain('--allow');
      expect(dangerArgs).not.toContain('--deny');
    });

    it('passes -m only when a model is set, and --fast adds no flag', async () => {
      spawnOk();
      await GROK_BACKEND.run(makeOpts({ model: 'grok-4.7', fast: true }));
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.indexOf('-m') + 1]).toBe('grok-4.7');
      expect(args).not.toContain('--fast');
      expect(args).not.toContain('-nc');
      expect(args).toEqual(buildGrokArgs({
        promptFile: args[args.indexOf('--prompt-file') + 1],
        repoPath: repo,
        sandbox: 'read-only',
        model: 'grok-4.7',
      }));
    });

    it('runs with the symlink-resolved repo path as cwd and --cwd', async () => {
      const link = join(root, 'link');
      symlinkSync(repo, link);
      spawnOk();
      await GROK_BACKEND.run(makeOpts({ repoPath: link }));
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.indexOf('--cwd') + 1]).toBe(repo);
      expect(mockSpawn.mock.calls[0][2].cwd).toBe(repo);
    });

    it('fails before spawning when the repo path cannot be resolved', async () => {
      await expect(GROK_BACKEND.run(makeOpts({ repoPath: join(root, 'nope') }))).rejects.toThrow(GrokBackendError);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns text for stopReason end_turn, which grok 1.0.62 emits for a normal answer', async () => {
      mockSpawn.mockReturnValue(mockChild(envelope('2', 'end_turn')));
      await expect(GROK_BACKEND.run(makeOpts())).resolves.toBe('2');
    });

    it('returns text for stopReason length and does not surface the session id', async () => {
      const onSessionCreated = vi.fn();
      mockSpawn.mockReturnValue(mockChild(envelope('partial', 'length')));
      await expect(GROK_BACKEND.run(makeOpts({ onSessionCreated }))).resolves.toBe('partial');
      expect(onSessionCreated).not.toHaveBeenCalled();
    });

    it.each([
      ['empty text', envelope('   '), /finished answer/],
      ['failed stop reason', envelope('nope', 'error'), /stopReason: error/],
      ['non-JSON stdout', 'hello', /not JSON/],
    ])('rejects %s', async (_label, stdout, pattern) => {
      mockSpawn.mockReturnValue(mockChild(stdout));
      await expect(GROK_BACKEND.run(makeOpts())).rejects.toThrow(pattern);
    });

    it('rejects a non-zero exit and still removes the prompt file', async () => {
      let promptPath = '';
      mockSpawn.mockImplementation((_command: string, args: string[]) => {
        promptPath = args[args.indexOf('--prompt-file') + 1];
        return mockChild('', 1, { stderr: 'auth failed' });
      });
      await expect(GROK_BACKEND.run(makeOpts())).rejects.toThrow(/exited with code 1: auth failed/);
      expect(existsSync(promptPath)).toBe(false);
    });

    it('rejects an exit-0 error envelope instead of returning its text', async () => {
      mockSpawn.mockReturnValue(mockChild(JSON.stringify({
        type: 'error',
        message: 'auth required',
        text: 'ignore me',
        stopReason: 'stop',
      })));
      await expect(GROK_BACKEND.run(makeOpts())).rejects.toThrow('Grok returned an error: auth required');
    });

    it('reads a JSON message from stdout when a non-zero exit has empty stderr', async () => {
      mockSpawn.mockReturnValue(mockChild(JSON.stringify({ message: 'not logged in' }), 1));
      await expect(GROK_BACKEND.run(makeOpts())).rejects.toThrow('Grok exited with code 1: not logged in');
    });

    it('sends SIGKILL 2s after a timed-out grok ignores SIGTERM', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const child = new EventEmitter() as EventEmitter & {
          stdout: Readable;
          stderr: Readable;
          kill: ReturnType<typeof vi.fn>;
        };
        child.stdout = new Readable({ read() {} });
        child.stderr = new Readable({ read() {} });
        child.kill = vi.fn((signal?: string) => {
          if (signal === 'SIGKILL') process.nextTick(() => child.emit('close', null, 'SIGKILL'));
          return true;
        });
        mockSpawn.mockReturnValue(child);

        const settled = GROK_BACKEND.run(makeOpts({ timeoutSeconds: 1 })).catch((err: unknown) => err);
        await vi.advanceTimersByTimeAsync(1000);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
        await vi.advanceTimersByTimeAsync(2000);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');

        const err = await settled;
        expect(err).toBeInstanceOf(GrokBackendError);
        expect((err as GrokBackendError).message).toMatch(/timed out after 1s/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('refuses --schema before spawn', async () => {
      await expect(GROK_BACKEND.run(makeOpts({ schema: '{"type":"object"}' }))).rejects.toThrow(GROK_SCHEMA_UNSUPPORTED);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it.each([
      ['GROK_AGENT', { GROK_AGENT: '1' }],
      ['PHONE_A_FRIEND_HOST', { PHONE_A_FRIEND_HOST: 'Grok' }],
    ])('refuses when %s marks Grok as the host, before spawn', async (_label, env) => {
      await expect(GROK_BACKEND.run(makeOpts({ env }))).rejects.toThrow(/already the host/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('parseGrokResult()', () => {
    it('returns the text of a finished envelope', () => {
      expect(parseGrokResult(envelope('2.'))).toBe('2.');
    });

    it('rejects a JSON array', () => {
      expect(() => parseGrokResult('[]')).toThrow(/not a result object/);
    });

    it('names an error envelope that has no message', () => {
      expect(() => parseGrokResult(JSON.stringify({ type: 'error' }))).toThrow(
        'Grok returned an error: Grok returned an error envelope.',
      );
    });
  });

  describe('isGrokHostEnv()', () => {
    it('matches the Grok child marker and the explicit host marker only', () => {
      expect(isGrokHostEnv({ GROK_AGENT: '1' })).toBe(true);
      expect(isGrokHostEnv({ PHONE_A_FRIEND_HOST: 'grok' })).toBe(true);
      expect(isGrokHostEnv({ PHONE_A_FRIEND_HOST: 'GROK' })).toBe(true);
      expect(isGrokHostEnv({ GROK_AGENT: 'true' })).toBe(false);
      expect(isGrokHostEnv({ PHONE_A_FRIEND_HOST: 'claude' })).toBe(false);
      expect(isGrokHostEnv({})).toBe(false);
    });
  });

  describe('relay session gates', () => {
    it('rejects --session and --backend-session without starting grok', async () => {
      await expect(relay({
        prompt: 'hi',
        repoPath: repo,
        backend: 'grok',
        session: 'label',
        includeDiff: false,
      })).rejects.toThrow(RelayError);
      await expect(relay({
        prompt: 'hi',
        repoPath: repo,
        backend: 'grok',
        session: 'label',
        includeDiff: false,
      })).rejects.toThrow(/--session is not supported by the grok backend/);

      await expect(relay({
        prompt: 'hi',
        repoPath: repo,
        backend: 'grok',
        backendSession: '01a14fbf-0000-7000-8000-000000000001',
        includeDiff: false,
      })).rejects.toThrow(/--backend-session is not supported by the grok backend/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('review session gates', () => {
    function git(...args: string[]): void {
      execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    }

    /** A committed file plus an unstaged edit, so a dropped flag would reach grok. */
    function dirtyWorkingTree(): void {
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 'paf-tests@example.com');
      git('config', 'user.name', 'PaF Tests');
      writeFileSync(join(repo, 'tracked.txt'), 'base\n');
      git('add', 'tracked.txt');
      git('commit', '-q', '-m', 'base');
      writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
    }

    async function reviewWith(flag: string, value: string): Promise<{ code: number; stderr: string }> {
      const saved = {
        GROK_AGENT: process.env.GROK_AGENT,
        PHONE_A_FRIEND_HOST: process.env.PHONE_A_FRIEND_HOST,
        PHONE_A_FRIEND_DEPTH: process.env.PHONE_A_FRIEND_DEPTH,
        PHONE_A_FRIEND_UPDATE_CHECK: process.env.PHONE_A_FRIEND_UPDATE_CHECK,
        CI: process.env.CI,
        TERM: process.env.TERM,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      };
      const stderrChunks: string[] = [];
      const origStderr = process.stderr.write;
      const origConsoleError = console.error;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      console.error = (...args: unknown[]) => {
        stderrChunks.push(args.map(String).join(' '));
      };
      delete process.env.GROK_AGENT;
      delete process.env.PHONE_A_FRIEND_HOST;
      process.env.PHONE_A_FRIEND_DEPTH = '0';
      process.env.PHONE_A_FRIEND_UPDATE_CHECK = 'false';
      process.env.CI = 'true';
      process.env.TERM = 'dumb';
      process.env.XDG_CONFIG_HOME = join(root, 'xdg');
      mockSpawn.mockImplementation(() => mockChild(envelope('should-not-run')));
      try {
        const code = await run([
          '--to', 'grok',
          '--repo', repo,
          '--review',
          '--review-scope', 'working-tree',
          flag, value,
        ]);
        return { code, stderr: stderrChunks.join('') };
      } finally {
        process.stderr.write = origStderr;
        console.error = origConsoleError;
        for (const [key, savedValue] of Object.entries(saved)) {
          if (savedValue === undefined) delete process.env[key];
          else process.env[key] = savedValue;
        }
      }
    }

    it.each([
      ['--session', 'kept-review', '--session is not supported by the grok backend (resume strategy: unsupported)'],
      ['--backend-session', '01a14fbf-0000-7000-8000-000000000001', '--backend-session is not supported by the grok backend (resume strategy: unsupported)'],
    ])('refuses %s on a dirty review without starting grok', async (flag, value, message) => {
      dirtyWorkingTree();
      const { code, stderr } = await reviewWith(flag, value);
      expect(code).toBe(1);
      expect(stderr).toContain(message);
      expect(stderr).not.toMatch(/Task [0-9a-f]{8} started/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});

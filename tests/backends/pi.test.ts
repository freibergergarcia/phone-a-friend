import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SandboxMode } from '../../src/backends/index.js';

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: mockExecFile, spawn: mockSpawn };
});

import { BACKEND_COMMANDS, INSTALL_HINTS, getBackend } from '../../src/backends/index.js';
import {
  PI_BACKEND,
  PiBackendError,
  _resetPiVersionCache,
  buildPiArgs,
  isPiHostEnv,
} from '../../src/backends/pi.js';
import { resolveConfig } from '../../src/config.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pi');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** Make `pi --version` (the version gate's probe) answer with the given output. */
function stubVersion(output: string | Error) {
  mockExecFile.mockImplementation((
    _path: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    if (output instanceof Error) cb(output, '', '');
    else cb(null, output, '');
  });
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

/** A child that produces nothing and only closes once it is killed. */
function hangingChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    process.nextTick(() => child.emit('close', null, 'SIGTERM'));
  });
  return child;
}

describe('pi backend', () => {
  let root: string;
  let repo: string;
  let bin: string;
  let xdg: string;

  function makeOpts(overrides: Record<string, unknown> = {}) {
    return {
      prompt: 'Review this code',
      repoPath: repo,
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null as string | null,
      env: { PATH: `${bin}:/usr/bin:/bin` } as Record<string, string>,
      ...overrides,
    };
  }

  function spawnArgs(): string[] {
    return mockSpawn.mock.calls[0][1] as string[];
  }

  function writeRepoConfig(toml: string) {
    writeFileSync(join(repo, '.phone-a-friend.toml'), toml);
  }

  function writeUserConfig(toml: string) {
    mkdirSync(join(xdg, 'phone-a-friend'), { recursive: true });
    writeFileSync(join(xdg, 'phone-a-friend', 'config.toml'), toml);
  }

  beforeEach(() => {
    // realpath: on macOS the temp dir itself sits behind a symlink.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'paf-pi-')));
    repo = join(root, 'repo');
    bin = join(root, 'bin');
    xdg = join(root, 'xdg');
    mkdirSync(repo);
    mkdirSync(bin);
    // The version gate resolves `pi` on PATH for real; only its execution is mocked.
    writeFileSync(join(bin, 'pi'), '#!/bin/sh\n', { mode: 0o755 });
    vi.stubEnv('XDG_CONFIG_HOME', xdg);
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    _resetPiVersionCache();
    stubVersion('0.87.1\n');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  describe('registration', () => {
    it('registers as "pi" with local file access and all three sandboxes', () => {
      const backend = getBackend('pi');
      expect(backend).toBe(PI_BACKEND);
      expect(backend.localFileAccess).toBe(true);
      expect([...backend.allowedSandboxes].sort()).toEqual([
        'danger-full-access',
        'read-only',
        'workspace-write',
      ]);
    });

    it('has no native review(), so every review scope uses the generic diff path', () => {
      expect((PI_BACKEND as { review?: unknown }).review).toBeUndefined();
      expect((PI_BACKEND as { nativeReviewScopes?: unknown }).nativeReviewScopes).toBeUndefined();
    });

    it('declares its executable and install hint', () => {
      expect(BACKEND_COMMANDS.pi).toBe('pi');
      expect(INSTALL_HINTS.pi).toBe('npm install -g @earendil-works/pi-coding-agent');
    });
  });

  describe('run()', () => {
    it('spawns pi with the built arguments and returns the final text', async () => {
      mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
      const opts = makeOpts();

      await expect(PI_BACKEND.run(opts)).resolves.toBe('OK');

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [command, args, spawnOpts] = mockSpawn.mock.calls[0];
      expect(command).toBe('pi');
      expect(args).toEqual(buildPiArgs({
        prompt: 'Review this code',
        sandbox: 'read-only',
        model: null,
        provider: null,
        fast: false,
        session: null,
      }));
      expect(spawnOpts.cwd).toBe(repo);
      expect(spawnOpts.env).toBe(opts.env);
    });

    it('runs with the symlink-resolved repo path as cwd', async () => {
      const link = join(root, 'link');
      symlinkSync(repo, link);
      mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));

      await PI_BACKEND.run(makeOpts({ repoPath: link }));

      expect(mockSpawn.mock.calls[0][2].cwd).toBe(repo);
    });

    it('fails before spawning when the repo path cannot be resolved', async () => {
      await expect(PI_BACKEND.run(makeOpts({ repoPath: join(root, 'nope') }))).rejects.toThrow(PiBackendError);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('maps each sandbox to its tool list', async () => {
      const expected: Record<SandboxMode, string> = {
        'read-only': 'read,grep,find,ls',
        'workspace-write': 'read,grep,find,ls,edit,write',
        'danger-full-access': 'read,grep,find,ls,edit,write,bash',
      };
      for (const sandbox of Object.keys(expected) as SandboxMode[]) {
        mockSpawn.mockReset();
        mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
        await PI_BACKEND.run(makeOpts({ sandbox }));
        const args = spawnArgs();
        expect(args[args.indexOf('--tools') + 1]).toBe(expected[sandbox]);
        expect(args).toContain('-ne');
        expect(args).toContain('--no-approve');
      }
    });

    it('passes the model, and -nc -ns for --fast', async () => {
      mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
      await PI_BACKEND.run(makeOpts({ model: 'mlx/mlx-community/Qwen3.5-9B-MLX-4bit', fast: true }));
      const args = spawnArgs();
      expect(args[args.indexOf('--model') + 1]).toBe('mlx/mlx-community/Qwen3.5-9B-MLX-4bit');
      expect(args).toContain('-nc');
      expect(args).toContain('-ns');
    });

    it('injects the schema into the prompt (pi has no structured-output flag)', async () => {
      mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
      await PI_BACKEND.run(makeOpts({ schema: '{"type":"object"}' }));
      const args = spawnArgs();
      expect(args[args.length - 1]).toBe(
        'Review this code\n\nRespond with JSON only. The response must match this JSON Schema exactly:\n{"type":"object"}',
      );
    });

    it('returns a JSON answer untouched so --schema stdout stays pure JSON', async () => {
      const json = '{"ok":true,"word":"PONG"}';
      const stream = [
        '{"type":"session","version":3,"id":"x","timestamp":"t","cwd":"/r"}',
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'plan' }, { type: 'text', text: `\n\n${json}` }],
            stopReason: 'stop',
          },
        }),
      ].join('\n');
      mockSpawn.mockReturnValue(mockChild(stream));
      const out = await PI_BACKEND.run(makeOpts({ schema: '{"type":"object"}' }));
      expect(out).toBe(json);
      expect(JSON.parse(out)).toEqual({ ok: true, word: 'PONG' });
    });

    it('stores nothing in pi for a plain relay', async () => {
      mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
      await PI_BACKEND.run(makeOpts());
      const args = spawnArgs();
      expect(args).toContain('--no-session');
      expect(args).not.toContain('--session-dir');
      expect(args).not.toContain('--session-id');
    });
  });

  describe('provider config', () => {
    const run = async (overrides: Record<string, unknown> = {}) => {
      mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
      await PI_BACKEND.run(makeOpts(overrides));
      return spawnArgs();
    };
    const providerOf = (args: string[]): string | undefined =>
      args.includes('--provider') ? args[args.indexOf('--provider') + 1] : undefined;

    it('passes no --provider when none is configured', async () => {
      expect(providerOf(await run())).toBeUndefined();
    });

    it("reads the provider from the repo's .phone-a-friend.toml, not from PaF's cwd", async () => {
      writeRepoConfig('[backends.pi]\nprovider = "mlx"\n');
      // process.cwd() is this checkout, which has no pi provider configured.
      expect(providerOf(await run())).toBe('mlx');
    });

    it('falls back to the user config', async () => {
      writeUserConfig('[backends.pi]\nprovider = "from-user"\n');
      expect(providerOf(await run())).toBe('from-user');
    });

    it('lets the repo config override the user config', async () => {
      writeUserConfig('[backends.pi]\nprovider = "from-user"\n');
      writeRepoConfig('[backends.pi]\nprovider = "from-repo"\n');
      expect(providerOf(await run())).toBe('from-repo');
    });

    it('passes provider and model as separate arguments', async () => {
      writeRepoConfig('[backends.pi]\nprovider = "mlx"\n');
      const args = await run({ model: 'mlx-community/Qwen3.5-9B-MLX-4bit' });
      expect(args.slice(args.indexOf('--provider'), args.indexOf('--provider') + 4)).toEqual([
        '--provider', 'mlx', '--model', 'mlx-community/Qwen3.5-9B-MLX-4bit',
      ]);
    });

    it.each([
      ['an empty string', 'provider = ""'],
      ['whitespace', 'provider = "   "'],
      ['a number', 'provider = 5'],
      ['a boolean', 'provider = true'],
      ['a table', 'provider = { name = "mlx" }'],
    ])('rejects %s with a clear error and never spawns', async (_label, line) => {
      writeRepoConfig(`[backends.pi]\n${line}\n`);
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/backends\.pi.*provider/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('resolves the configured model, and lets --model override it', () => {
      writeRepoConfig('[backends.pi]\nprovider = "mlx"\nmodel = "configured-model"\n');
      expect(resolveConfig({ to: 'pi' }, {}, repo, xdg).model).toBe('configured-model');
      expect(resolveConfig({ to: 'pi', model: 'cli-model' }, {}, repo, xdg).model).toBe('cli-model');
    });
  });

  describe('errors', () => {
    it('explains a timeout in terms of a local model server', async () => {
      mockSpawn.mockReturnValue(hangingChild());
      const attempt = PI_BACKEND.run(makeOpts({ timeoutSeconds: 0.02 }));
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/pi timed out after 0\.02s/);
      await expect(attempt).rejects.toThrow(/check the server is up/);
      await expect(attempt).rejects.toThrow(/smaller model/);
    });

    it('surfaces the stderr tail and exit code on a nonzero exit', async () => {
      mockSpawn.mockReturnValue(mockChild('', 1, {
        stderr: 'Error: Unknown provider "nope". Use --list-models to see available providers/models.\n',
      }));
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/exited with code 1/);
      await expect(attempt).rejects.toThrow(/Unknown provider "nope"/);
    });

    it('prefers the final error in the JSONL stream over stderr on a nonzero exit', async () => {
      mockSpawn.mockReturnValue(mockChild(fixture('error-exit-zero.jsonl'), 1, { stderr: 'some noise\n' }));
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(/404/);
      await expect(attempt).rejects.not.toThrow(/some noise/);
    });

    it('fails on an error stream even though pi exited 0', async () => {
      mockSpawn.mockReturnValue(mockChild(fixture('retry-connection-error.jsonl'), 0));
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/Connection error\./);
      await expect(attempt).rejects.toThrow(/check the server is up/);
    });

    it('includes stderr when pi exits 0 without an assistant message', async () => {
      mockSpawn.mockReturnValue(mockChild('{"type":"agent_start"}\n', 0, { stderr: 'Warning: odd startup\n' }));
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(/no assistant message/);
      await expect(attempt).rejects.toThrow(/odd startup/);
    });

    it('wraps a spawn failure', async () => {
      const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => void };
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      child.kill = () => {};
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => child.emit('error', new Error('spawn pi EACCES')));
        return child;
      });
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/failed to start/);
    });
  });

  describe('recursion guard', () => {
    it('detects pi as the host from its process marker or the PaF host marker', () => {
      expect(isPiHostEnv({ PI_CODING_AGENT: 'true' })).toBe(true);
      expect(isPiHostEnv({ PHONE_A_FRIEND_HOST: 'pi' })).toBe(true);
      expect(isPiHostEnv({ PHONE_A_FRIEND_HOST: 'PI' })).toBe(true);
    });

    it('does not block on unrelated environment', () => {
      expect(isPiHostEnv({})).toBe(false);
      expect(isPiHostEnv({ PI_CODING_AGENT: 'false' })).toBe(false);
      expect(isPiHostEnv({ PI_CODING_AGENT: '1' })).toBe(false);
      expect(isPiHostEnv({ PHONE_A_FRIEND_HOST: 'opencode' })).toBe(false);
      // The generic marker alone is not pi-specific enough to block on.
      expect(isPiHostEnv({ AI_AGENT: 'pi' })).toBe(false);
      expect(isPiHostEnv({ PI_OFFLINE: '1', PI_CODING_AGENT_DIR: '/somewhere' })).toBe(false);
    });

    it.each([
      ['PI_CODING_AGENT=true', { PI_CODING_AGENT: 'true' }],
      ['PHONE_A_FRIEND_HOST=pi', { PHONE_A_FRIEND_HOST: 'pi' }],
    ])('refuses --to pi under %s before probing or spawning', async (_label, marker) => {
      const env = { PATH: `${bin}:/usr/bin:/bin`, ...marker };
      await expect(PI_BACKEND.run(makeOpts({ env }))).rejects.toThrow(/pi is already the host/);
      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('version gate', () => {
    it('accepts the minimum supported version', async () => {
      stubVersion('0.79.0\n');
      mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
      await expect(PI_BACKEND.run(makeOpts())).resolves.toBe('OK');
    });

    it.each(['0.78.9', '0.68.0', '0.9.0'])('refuses pi %s with an upgrade hint and never spawns', async (version) => {
      stubVersion(`${version}\n`);
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(new RegExp(`pi ${version.replace(/\./g, '\\.')} is too old`));
      await expect(attempt).rejects.toThrow(/0\.79\.0/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('refuses to run when the version cannot be read', async () => {
      stubVersion('pi: no version here\n');
      const attempt = PI_BACKEND.run(makeOpts());
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/could not read the pi version/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('refuses to run when the version probe fails', async () => {
      stubVersion(Object.assign(new Error('boom'), { code: 2 }));
      await expect(PI_BACKEND.run(makeOpts())).rejects.toThrow(/could not read the pi version/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('reports a missing executable with the install hint, without probing or spawning', async () => {
      const env = { PATH: `${join(root, 'empty')}:/nonexistent` };
      const attempt = PI_BACKEND.run(makeOpts({ env }));
      await expect(attempt).rejects.toThrow(/pi CLI not found in PATH/);
      await expect(attempt).rejects.toThrow(/npm install -g @earendil-works\/pi-coding-agent/);
      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('probes the version once across runs', async () => {
      for (let i = 0; i < 3; i++) {
        mockSpawn.mockReturnValue(mockChild(fixture('session-start.jsonl')));
        await PI_BACKEND.run(makeOpts());
      }
      expect(mockExecFile).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });
  });
});

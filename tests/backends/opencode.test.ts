import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** Make `opencode --version` (the major probe) answer with the given banner. */
function stubVersion(banner: string | Error) {
  mockExecFile.mockImplementation((_path: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (banner instanceof Error) cb(banner, '', '');
    else cb(null, banner, '');
  });
}

import {
  _resetOpenCodeMajorCache,
  buildOpenCodeArgs,
  describeOpenCodeError,
  isOpenCodeHostEnv,
  OPENCODE_BACKEND,
  parseOpenCodeTranscript,
} from '../../src/backends/opencode.js';

function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'Review this code',
    repoPath: '/tmp/repo',
    timeoutSeconds: 60,
    sandbox: 'read-only' as SandboxMode,
    model: null as string | null,
    env: {} as Record<string, string>,
    ...overrides,
  };
}

function mockChildProcess(stdout: string, exitCode = 0, opts?: { stderr?: string }) {
  const stdoutStream = Readable.from([Buffer.from(stdout)]);
  const stderrStream = Readable.from(opts?.stderr ? [Buffer.from(opts.stderr)] : []);
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    killed: boolean;
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.killed = false;
  child.exitCode = null;
  child.kill = vi.fn(() => { child.killed = true; });

  stdoutStream.on('end', () => {
    child.exitCode = exitCode;
    process.nextTick(() => child.emit('close', exitCode, null));
  });

  return child;
}

describe('OpenCode backend', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    _resetOpenCodeMajorCache();
    // Existing tests were written against the 1.x line; keep them there.
    stubVersion('1.18.32');
  });

  it('builds basic opencode run args', () => {
    expect(buildOpenCodeArgs({
      prompt: 'hi',
      repoPath: '/repo',
      model: 'qwen3-coder',
      provider: 'ollama',
      fast: true,
      sessionId: null,
      resumeSession: false,
      major: 1,
    })).toEqual([
      'run',
      '--format',
      'json',
      '--dir',
      '/repo',
      '--model',
      'ollama/qwen3-coder',
      '--pure',
      'hi',
    ]);
  });

  it('detects OpenCode host marker env', () => {
    expect(isOpenCodeHostEnv({ PHONE_A_FRIEND_HOST: 'opencode' })).toBe(true);
    expect(isOpenCodeHostEnv({ PHONE_A_FRIEND_HOST: 'claude' })).toBe(false);
    expect(isOpenCodeHostEnv({})).toBe(false);
  });

  it('does not block on bare OPENCODE_* env vars (previously a false-positive vector)', () => {
    // Users running their own OpenCode server may have OPENCODE_SERVER_PASSWORD
    // or similar in their shell rc. Those should NOT trigger the recursion
    // guard from a regular terminal — only PHONE_A_FRIEND_HOST does.
    expect(isOpenCodeHostEnv({ OPENCODE_SESSION_ID: 'session-1' })).toBe(false);
    expect(isOpenCodeHostEnv({ OPENCODE_SERVER_PASSWORD: 'secret' })).toBe(false);
    expect(isOpenCodeHostEnv({ OPENCODE_HOME: '/somewhere' })).toBe(false);
  });

  it('blocks recursive OpenCode backend calls when OpenCode is the host', async () => {
    await expect(OPENCODE_BACKEND.run(makeOpts({
      env: { PHONE_A_FRIEND_HOST: 'opencode' },
    }))).rejects.toThrow(/OpenCode is already the host/);
  });

  it('parses step_start-only transcripts as empty text (silent tool-loop case)', () => {
    // Reproduces the scenario where opencode's build agent terminates after a
    // tool-use step without producing any text content. Parser must return
    // empty text so callers can surface a clear error instead of returning '' to the user.
    const jsonl =
      '{"type":"step_start","timestamp":1,"sessionID":"ses_x","part":{"type":"step-start"}}\n' +
      '{"type":"step-start","timestamp":2,"sessionID":"ses_x","part":{"type":"step-start"}}';
    const parsed = parseOpenCodeTranscript(jsonl);
    expect(parsed.text).toBe('');
    expect(parsed.sessionId).toBe('ses_x');
  });

  it('extracts text from text events in the transcript', () => {
    const jsonl =
      '{"type":"step_start","timestamp":1,"sessionID":"ses_y","part":{}}\n' +
      '{"type":"text","timestamp":2,"sessionID":"ses_y","part":{"text":"4"}}';
    const parsed = parseOpenCodeTranscript(jsonl);
    expect(parsed.text).toBe('4');
    expect(parsed.sessionId).toBe('ses_y');
  });

  describe('error event extraction', () => {
    // Captured verbatim from `opencode run --format json --model <retired-model>`
    // on opencode 1.18.15. The model had been removed from the provider's
    // catalog; opencode reports it as a generic UnknownError on stdout and
    // exits 1, naming neither the model nor how to list valid ones.
    const ERROR_EVENT =
      '{"type":"error","timestamp":1786280575246,"sessionID":"ses_0196187cfffePSBET63aaVLiQX",' +
      '"error":{"name":"UnknownError","data":{"message":"Unexpected server error. ' +
      'Check server logs for details.","ref":"err_80583ae1"}}}';

    it('surfaces the message from an error event instead of dropping it', () => {
      const parsed = parseOpenCodeTranscript(ERROR_EVENT);
      expect(parsed.error).toContain('Unexpected server error');
      expect(parsed.text).toBe('');
    });

    it('includes the opencode ref so server logs can be correlated', () => {
      const parsed = parseOpenCodeTranscript(ERROR_EVENT);
      expect(parsed.error).toContain('err_80583ae1');
    });

    it('still captures the session id from an error-only transcript', () => {
      const parsed = parseOpenCodeTranscript(ERROR_EVENT);
      expect(parsed.sessionId).toBe('ses_0196187cfffePSBET63aaVLiQX');
    });

    it('falls back to the error name when no message is present', () => {
      const jsonl = '{"type":"error","sessionID":"ses_z","error":{"name":"ProviderAuthError"}}';
      const parsed = parseOpenCodeTranscript(jsonl);
      expect(parsed.error).toContain('ProviderAuthError');
    });

    it('surfaces a 2.x error event, which carries error.type and error.message', () => {
      // Captured from @opencode/cli 2.0.14 (`opencode run --format json`):
      const jsonl =
        '{"type":"error","timestamp":1790411474875,"sessionID":"ses_f2328f916ffetISG9mGJPcw5A8",' +
        '"error":{"type":"provider.auth","message":"Request failed: 401"}}';
      const parsed = parseOpenCodeTranscript(jsonl);
      expect(parsed.error).toBe('Request failed: 401 (provider.auth)');
      expect(parsed.sessionId).toBe('ses_f2328f916ffetISG9mGJPcw5A8');
    });

    it('leaves error unset for a healthy transcript', () => {
      const jsonl = '{"type":"text","sessionID":"ses_ok","part":{"text":"hi"}}';
      expect(parseOpenCodeTranscript(jsonl).error).toBeUndefined();
    });
  });

  describe('describeOpenCodeError()', () => {
    it('names the model and points at `opencode models` when a model was passed', () => {
      const msg = describeOpenCodeError('Unexpected server error.', 'wpcom-ai/qwen3-next-80b-a3b');
      expect(msg).toContain('Unexpected server error.');
      expect(msg).toContain('wpcom-ai/qwen3-next-80b-a3b');
      expect(msg).toContain('opencode models');
    });

    it('leaves the message alone when no model was passed', () => {
      const msg = describeOpenCodeError('Unexpected server error.', null);
      expect(msg).toBe('Unexpected server error.');
    });
  });

  describe('run() — structured error surfacing on non-zero exit', () => {
    it('surfaces the error event from a failed run instead of a bare exit message', async () => {
      // opencode writes the error event to stdout AND exits 1, so spawnCli
      // throws before the transcript is parsed. The failure path must still
      // read the captured stdout, or the user gets an opaque exit error.
      const errorEvent =
        '{"type":"error","timestamp":1,"sessionID":"ses_e","error":{"name":"UnknownError",' +
        '"data":{"message":"Unexpected server error. Check server logs for details.",' +
        '"ref":"err_deadbeef"}}}\n';

      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(errorEvent, 1));

      await expect(
        OPENCODE_BACKEND.run(makeOpts({ model: 'wpcom-ai/qwen3-next-80b-a3b' })),
      ).rejects.toThrow(/wpcom-ai\/qwen3-next-80b-a3b/);
    });

    it('mentions `opencode models` so an invalid model id is self-diagnosing', async () => {
      const errorEvent =
        '{"type":"error","timestamp":1,"sessionID":"ses_e","error":{"name":"UnknownError",' +
        '"data":{"message":"Unexpected server error.","ref":"err_1"}}}\n';

      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(errorEvent, 1));

      await expect(
        OPENCODE_BACKEND.run(makeOpts({ model: 'ollama/qwen3-coder' })),
      ).rejects.toThrow(/opencode models/);
    });
  });

  describe('runStream() — structured error surfacing', () => {
    // Streaming is the DEFAULT path (defaults.stream = true), so this is the
    // path a normal `--to opencode` relay actually takes. A model missing from
    // the provider catalog must be as self-diagnosing here as in run().
    const errorEvent =
      '{"type":"error","timestamp":1,"sessionID":"ses_s","error":{"name":"UnknownError",' +
      '"data":{"message":"Unexpected server error. Check server logs for details.",' +
      '"ref":"err_stream1"}}}\n';

    async function streamError(opts: Record<string, unknown>): Promise<Error | null> {
      try {
        for await (const _chunk of OPENCODE_BACKEND.runStream!(makeOpts(opts))) {
          // drain
        }
        return null;
      } catch (e) {
        return e as Error;
      }
    }

    it('adds model context on a non-zero exit', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(errorEvent, 1));

      const err = await streamError({ model: 'wpcom-ai/qwen3-next-80b-a3b' });
      expect(err?.message).toMatch(/wpcom-ai\/qwen3-next-80b-a3b/);
      expect(err?.message).toMatch(/opencode models/);
    });

    it('adds model context on a clean exit carrying an error event', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(errorEvent, 0));

      const err = await streamError({ model: 'ollama/qwen3-coder' });
      expect(err?.message).toMatch(/ollama\/qwen3-coder/);
      expect(err?.message).toMatch(/opencode models/);
    });

    it('leaves the message unadorned when no model was passed', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(errorEvent, 1));

      const err = await streamError({});
      expect(err?.message).toMatch(/Unexpected server error/);
      expect(err?.message).not.toMatch(/opencode models/);
    });
  });

  describe('runStream() — silent-output guard', () => {
    it('throws when opencode exits cleanly without emitting any text part', async () => {
      // Reproduces the silent-failure mode: build agent emits only step_start
      // events and exits 0. Previously the streaming path swallowed this and
      // PaF printed "opencode responded" with empty stdout. The guard ensures
      // streaming callers see the same actionable error as batch callers.
      const stepStartOnly =
        '{"type":"step_start","timestamp":1,"sessionID":"ses_a","part":{"type":"step-start"}}\n' +
        '{"type":"step_start","timestamp":2,"sessionID":"ses_a","part":{"type":"step-start"}}\n';

      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(stepStartOnly, 0));

      const err = await (async () => {
        try {
          for await (const _chunk of OPENCODE_BACKEND.runStream!(makeOpts())) {
            // drain
          }
          return null;
        } catch (e) {
          return e as Error;
        }
      })();

      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toMatch(/produced no text output/);
      expect(err?.message).toMatch(/terminated mid tool-call/);
    });

    it('does not throw when opencode emits at least one text part', async () => {
      const withText =
        '{"type":"step_start","timestamp":1,"sessionID":"ses_b","part":{}}\n' +
        '{"type":"text","timestamp":2,"sessionID":"ses_b","part":{"text":"hello"}}\n';

      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(withText, 0));

      const chunks: string[] = [];
      for await (const chunk of OPENCODE_BACKEND.runStream!(makeOpts())) {
        chunks.push(chunk);
      }
      expect(chunks.join('')).toBe('hello');
    });
  });

  describe('runStream() — error surfacing', () => {
    // OpenCode emits errors as JSON on stdout (verified shape), not stderr.
    const errorEvent =
      '{"type":"error","timestamp":1,"sessionID":"ses_e","error":' +
      '{"name":"UnknownError","data":{"message":"Model not found: ollama/bogus-model."}}}\n';

    async function collectError(gen: AsyncGenerator<string>): Promise<Error | null> {
      try {
        for await (const _chunk of gen) {
          // drain
        }
        return null;
      } catch (e) {
        return e as Error;
      }
    }

    it('surfaces the stdout JSON error detail on a non-zero exit (not the generic message)', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(errorEvent, 1));

      const err = await collectError(OPENCODE_BACKEND.runStream!(makeOpts()));

      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toMatch(/Model not found: ollama\/bogus-model/);
      expect(err?.message).not.toMatch(/exited with code 1/);
    });

    it('prefers a stdout error event over the silent-output guard on a clean exit', async () => {
      // Error event with zero text parts and a clean (0) exit: the error must
      // win over the "produced no text output" guard so the real cause shows.
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(errorEvent, 0));

      const err = await collectError(OPENCODE_BACKEND.runStream!(makeOpts()));

      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toMatch(/Model not found: ollama\/bogus-model/);
      expect(err?.message).not.toMatch(/produced no text output/);
    });
  });

  describe('major-aware spawn arguments', () => {
    // The probe resolves `opencode` through PATH, so give it a stub binary in a
    // temp dir. execFile is mocked, so the stub is never actually executed.
    let stubRoot: string;
    beforeEach(() => {
      stubRoot = mkdtempSync(join(tmpdir(), 'paf-opencode-stub-'));
      mkdirSync(join(stubRoot, 'bin'));
      writeFileSync(join(stubRoot, 'bin', 'opencode'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    });
    afterEach(() => rmSync(stubRoot, { recursive: true, force: true }));
    const withPath = (overrides: Record<string, unknown> = {}) =>
      makeOpts({ env: { PATH: `${stubRoot}/bin` }, ...overrides });

    const okTranscript =
      '{"type":"step_start","timestamp":1,"sessionID":"ses_w","part":{}}\n' +
      '{"type":"text","timestamp":2,"sessionID":"ses_w","part":{"text":"ok"}}\n';

    function spawnedArgs(): string[] {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      return mockSpawn.mock.calls[0][1] as string[];
    }

    it('run() keeps --dir on 1.x and drops it on 2.x', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
      await OPENCODE_BACKEND.run(withPath());
      expect(spawnedArgs()).toEqual(['run', '--format', 'json', '--dir', '/tmp/repo', 'Review this code']);

      mockSpawn.mockReset();
      _resetOpenCodeMajorCache();
      stubVersion('opencode v2.0.14');
      mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
      await OPENCODE_BACKEND.run(withPath());
      expect(spawnedArgs()).toEqual(['run', '--format', 'json', 'Review this code']);
    });

    it('run() spawns with cwd set to the repo on both lines', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      stubVersion('opencode v2.0.14');
      mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
      await OPENCODE_BACKEND.run(withPath({ repoPath: '/tmp/elsewhere' }));
      expect((mockSpawn.mock.calls[0][2] as { cwd?: string }).cwd).toBe('/tmp/elsewhere');
    });

    it('runStream() and review() follow the same rule', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      stubVersion('opencode v2.0.14');
      mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
      for await (const _chunk of OPENCODE_BACKEND.runStream!(withPath())) { /* drain */ }
      expect(spawnedArgs()).not.toContain('--dir');

      mockSpawn.mockReset();
      mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
      await OPENCODE_BACKEND.review!({ ...withPath(), base: 'main' });
      expect(spawnedArgs()).not.toContain('--dir');
    });

    it('run() with --fast fails closed when the version cannot be read, without spawning', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      stubVersion(new Error('spawn opencode ENOENT'));
      await expect(OPENCODE_BACKEND.run(withPath({ fast: true }))).rejects.toThrow(/version/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('run() without version-specific options proceeds with neutral args when the version is unknown', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
      stubVersion(new Error('spawn opencode ENOENT'));
      mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
      await OPENCODE_BACKEND.run(withPath());
      expect(spawnedArgs()).toEqual(['run', '--format', 'json', 'Review this code']);
    });

    it('backends.opencode.standalone = true in config.toml reaches run(), runStream() and review() on 2.x and is dropped on 1.x', async () => {
      // A real TOML file read through loadConfig(): this pins the config-to-spawn
      // path end to end, not only the argument builder.
      mkdirSync(join(stubRoot, 'phone-a-friend'));
      writeFileSync(join(stubRoot, 'phone-a-friend', 'config.toml'), '[backends.opencode]\nstandalone = true\n');
      vi.stubEnv('XDG_CONFIG_HOME', stubRoot);
      try {
        mockExecFileSync.mockReturnValue('/usr/local/bin/opencode');
        stubVersion('opencode v2.0.14');
        mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
        await OPENCODE_BACKEND.run(withPath());
        expect(spawnedArgs()).toEqual(['run', '--format', 'json', '--standalone', 'Review this code']);

        mockSpawn.mockReset();
        mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
        for await (const _chunk of OPENCODE_BACKEND.runStream!(withPath())) { /* drain */ }
        expect(spawnedArgs()).toContain('--standalone');

        mockSpawn.mockReset();
        mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
        await OPENCODE_BACKEND.review!({ ...withPath(), base: 'main' });
        expect(spawnedArgs()).toContain('--standalone');

        // 1.x has no --standalone; the setting must not leak into its argument vector.
        mockSpawn.mockReset();
        _resetOpenCodeMajorCache();
        stubVersion('1.18.32');
        mockSpawn.mockReturnValue(mockChildProcess(okTranscript, 0));
        await OPENCODE_BACKEND.run(withPath());
        expect(spawnedArgs()).toEqual(['run', '--format', 'json', '--dir', '/tmp/repo', 'Review this code']);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

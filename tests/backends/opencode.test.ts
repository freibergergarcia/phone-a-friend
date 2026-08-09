import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
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
    mockSpawn.mockReset();
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
});

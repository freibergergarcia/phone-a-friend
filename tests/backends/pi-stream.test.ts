import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackendEvent, SandboxMode } from '../../src/backends/index.js';

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: mockExecFile, spawn: mockSpawn };
});

import {
  PI_BACKEND,
  PI_KILL_GRACE_MS,
  PiBackendError,
  _resetPiVersionCache,
  buildPiArgs,
  parsePiJsonl,
  piEventsFromRecord,
} from '../../src/backends/pi.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pi');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

type FakeChild = EventEmitter & {
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

/** A child whose stdout arrives in the given chunks, then closes with the exit code. */
function chunkedChild(chunks: Array<string | Buffer>, exitCode = 0, opts: { stderr?: string } = {}): FakeChild {
  const stdoutStream = Readable.from(chunks.map((chunk) => (typeof chunk === 'string' ? Buffer.from(chunk) : chunk)));
  const stderrStream = Readable.from(opts.stderr ? [Buffer.from(opts.stderr)] : []);
  const child = new EventEmitter() as FakeChild;
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
function hangingChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stdout = new Readable({ read() {} });
  child.stdout = stdout;
  child.stderr = new Readable({ read() {} });
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    stdout.push(null);
    process.nextTick(() => child.emit('close', null, 'SIGTERM'));
  });
  return child;
}

/** A child that ignores SIGTERM and only closes on SIGKILL. */
function stubbornChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stdout = new Readable({ read() {} });
  child.stdout = stdout;
  child.stderr = new Readable({ read() {} });
  child.killed = false;
  child.kill = vi.fn((signal?: string) => {
    if (signal !== 'SIGKILL') return true;
    child.killed = true;
    stdout.push(null);
    process.nextTick(() => child.emit('close', null, 'SIGKILL'));
    return true;
  });
  return child;
}

function sliceBytes(text: string, size: number): Buffer[] {
  const bytes = Buffer.from(text, 'utf8');
  const out: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

const HEADER = '{"type":"session","version":3,"id":"abc","timestamp":"t","cwd":"/repo"}';

function record(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function textDelta(delta: string, contentIndex = 0): string {
  return record({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex, delta } });
}

function assistantStart(): string {
  return record({ type: 'message_start', message: { role: 'assistant', content: [], stopReason: 'pending' } });
}

function assistantEnd(text: string, stopReason = 'stop', extra: Record<string, unknown> = {}): string {
  return record({
    type: 'message_end',
    message: { role: 'assistant', content: text ? [{ type: 'text', text }] : [], stopReason, ...extra },
  });
}

describe('pi backend streaming', () => {
  let root: string;
  let repo: string;
  let bin: string;

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

  async function collect(overrides: Record<string, unknown> = {}): Promise<string[]> {
    const chunks: string[] = [];
    for await (const chunk of PI_BACKEND.runStream(makeOpts(overrides))) chunks.push(chunk);
    return chunks;
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'paf-pi-stream-')));
    repo = join(root, 'repo');
    bin = join(root, 'bin');
    mkdirSync(repo);
    mkdirSync(bin);
    writeFileSync(join(bin, 'pi'), '#!/bin/sh\n', { mode: 0o755 });
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    _resetPiVersionCache();
    mockExecFile.mockImplementation((
      _path: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => cb(null, '0.87.1\n', ''));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  describe('runStream()', () => {
    it('spawns with the same arguments and cwd as run()', async () => {
      mockSpawn.mockReturnValue(chunkedChild([fixture('session-start.jsonl')]));
      await collect({ model: 'm', fast: true });
      const [command, args, spawnOpts] = mockSpawn.mock.calls[0];
      expect(command).toBe('pi');
      expect(args).toEqual(buildPiArgs({
        prompt: 'Review this code',
        sandbox: 'read-only',
        model: 'm',
        provider: null,
        fast: true,
        session: null,
      }));
      expect(spawnOpts.cwd).toBe(repo);
    });

    it('streams the text deltas of a real run and nothing else', async () => {
      mockSpawn.mockReturnValue(chunkedChild([fixture('session-start.jsonl')]));
      const chunks = await collect();
      // The captured text block is "\n\nOK": leading whitespace is dropped,
      // and no thinking delta is ever yielded.
      expect(chunks.join('')).toBe('OK');
      expect(chunks.join('')).not.toMatch(/secret word/);
    });

    it('streams the final answer after tool calls, matching the batch answer', async () => {
      const stream = fixture('tool-calls.jsonl');
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      const streamed = (await collect()).join('');
      expect(streamed).toBe(parsePiJsonl(stream).text);
      expect(streamed.startsWith('I was unable to create the file.')).toBe(true);
    });

    it('yields several deltas as they arrive', async () => {
      const stream = [HEADER, assistantStart(), textDelta('Hel'), textDelta('lo'), textDelta(' world'), assistantEnd('Hello world')].join('\n') + '\n';
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      expect(await collect()).toEqual(['Hel', 'lo', ' world']);
    });

    it('reassembles records and multi-byte characters split across chunks, on LF only', async () => {
      const text = 'héllo — 世界 still one record';
      const stream = [HEADER, assistantStart(), textDelta(text), assistantEnd(text)].join('\n') + '\n';
      for (const size of [1, 3, 7, 64]) {
        mockSpawn.mockReturnValue(chunkedChild(sliceBytes(stream, size)));
        expect((await collect()).join('')).toBe(text);
      }
    });

    it('handles CRLF record endings', async () => {
      const stream = [HEADER, assistantStart(), textDelta('hi'), assistantEnd('hi')].join('\r\n') + '\r\n';
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      expect((await collect()).join('')).toBe('hi');
    });

    it('falls back to the final message text when the provider sent no deltas', async () => {
      const stream = [HEADER, assistantStart(), assistantEnd('\n\nwhole answer')].join('\n') + '\n';
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      expect((await collect()).join('')).toBe('whole answer');
    });

    it('drops whitespace at the end of a message, and keeps it inside one', async () => {
      const stream = [
        HEADER, assistantStart(),
        textDelta('\n one'), textDelta(' \n'), textDelta('\ntwo'), textDelta('  \n\n'),
        assistantEnd('\n one \n\ntwo  \n\n'),
      ].join('\n') + '\n';
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      expect((await collect()).join('')).toBe('one \n\ntwo');
    });

    it('joins the text blocks of one message as the batch path does', async () => {
      const end = record({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] },
      });
      const stream = [HEADER, assistantStart(), textDelta('first', 0), textDelta('second', 2), end].join('\n') + '\n';
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      expect((await collect()).join('')).toBe(parsePiJsonl(stream).text);
      expect(parsePiJsonl(stream).text).toBe('first\nsecond');
    });

    it('confirms a started session at the end of the stream', async () => {
      const id = '0b9d6c1e-6f0a-4b7e-9c55-2f3d1a4e8b10';
      const header = (cwd: string): string => record({ type: 'session', version: 3, id, timestamp: 't', cwd });
      const body = [assistantStart(), textDelta('hi'), assistantEnd('hi')];
      const onSessionCreated = vi.fn();

      mockSpawn.mockReturnValue(chunkedChild([[header(repo), ...body].join('\n') + '\n']));
      expect((await collect({ sessionId: id, onSessionCreated })).join('')).toBe('hi');
      expect(onSessionCreated).toHaveBeenCalledWith(id);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.indexOf('--session-id') + 1]).toBe(id);
      expect(args).not.toContain('--no-session');

      onSessionCreated.mockClear();
      mockSpawn.mockReturnValue(chunkedChild([[header('/somewhere/else'), ...body].join('\n') + '\n']));
      await expect(collect({ sessionId: id, onSessionCreated })).rejects.toThrow(/not the requested/);
      expect(onSessionCreated).not.toHaveBeenCalled();
    });

    it('stops the child when the consumer stops reading', async () => {
      const child = hangingChild();
      mockSpawn.mockReturnValue(child);
      const stream = PI_BACKEND.runStream(makeOpts());
      const first = stream.next();
      child.stdout.push(Buffer.from([HEADER, assistantStart(), textDelta('partial')].join('\n') + '\n'));
      expect((await first).value).toBe('partial');
      await stream.return(undefined);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('separates the text of successive assistant messages', async () => {
      const stream = [
        HEADER,
        assistantStart(), textDelta('\n\nLet me look.'), assistantEnd('\n\nLet me look.', 'toolUse'),
        assistantStart(), textDelta('\n\nDone.'), assistantEnd('\n\nDone.'),
      ].join('\n') + '\n';
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      expect((await collect()).join('')).toBe('Let me look.\n\nDone.');
    });

    it('throws at the end of the stream when the response failed, even on exit 0', async () => {
      mockSpawn.mockReturnValue(chunkedChild([fixture('retry-connection-error.jsonl')], 0));
      const attempt = collect();
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/Connection error\./);
      await expect(attempt).rejects.toThrow(/check the server is up/);
    });

    it('throws when the stream ends without a final answer', async () => {
      const stream = [HEADER, assistantStart(), textDelta('partial'), assistantEnd('partial', 'toolUse')].join('\n') + '\n';
      mockSpawn.mockReturnValue(chunkedChild([stream]));
      await expect(collect()).rejects.toThrow(/toolUse/);
    });

    it('surfaces stderr on a nonzero exit', async () => {
      mockSpawn.mockReturnValue(chunkedChild([], 1, { stderr: 'Error: Unknown provider "nope".\n' }));
      const attempt = collect();
      await expect(attempt).rejects.toThrow(/exited with code 1/);
      await expect(attempt).rejects.toThrow(/Unknown provider "nope"/);
    });

    it('prefers the stream error over stderr on a nonzero exit', async () => {
      mockSpawn.mockReturnValue(chunkedChild([fixture('error-exit-zero.jsonl')], 1, { stderr: 'some noise\n' }));
      await expect(collect()).rejects.toThrow(/404/);
    });

    it('kills the child and explains a timeout', async () => {
      const child = hangingChild();
      mockSpawn.mockReturnValue(child);
      const attempt = collect({ timeoutSeconds: 0.02 });
      await expect(attempt).rejects.toThrow(/pi timed out after 0\.02s/);
      await expect(attempt).rejects.toThrow(/check the server is up/);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('reports a child killed by a signal', async () => {
      const child = hangingChild();
      mockSpawn.mockReturnValue(child);
      const attempt = collect();
      setTimeout(() => child.kill('SIGTERM'), 5);
      await expect(attempt).rejects.toThrow(/pi killed by signal SIGTERM/);
    });

    it('reports a broken stdout stream rather than the kill it caused', async () => {
      const child = hangingChild();
      mockSpawn.mockReturnValue(child);
      const attempt = collect();
      setTimeout(() => child.stdout.destroy(new Error('EPIPE on read')), 5);
      await expect(attempt).rejects.toThrow(/pi stream error: EPIPE on read/);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    describe('a child that ignores SIGTERM', () => {
      beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
      afterEach(() => { vi.useRealTimers(); });

      it('is killed after the grace period, so the timeout still ends the run', async () => {
        const child = stubbornChild();
        mockSpawn.mockReturnValue(child);
        const attempt = collect({ timeoutSeconds: 5 });
        const settled = attempt.then(() => 'resolved', (err: Error) => err.message);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
        await vi.advanceTimersByTimeAsync(PI_KILL_GRACE_MS);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(await settled).toMatch(/pi timed out after 5s/);
      });

      it('is killed on the batch path too, which review, --schema and session calls use', async () => {
        const child = stubbornChild();
        mockSpawn.mockReturnValue(child);
        const settled = PI_BACKEND.run(makeOpts({ timeoutSeconds: 5 })).then(() => 'resolved', (err: Error) => err.message);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
        await vi.advanceTimersByTimeAsync(PI_KILL_GRACE_MS);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(await settled).toMatch(/pi timed out after 5s/);
      });

      it('is killed when the consumer stops reading, and return() waits for it to exit', async () => {
        const child = stubbornChild();
        mockSpawn.mockReturnValue(child);
        const stream = PI_BACKEND.runStream(makeOpts());
        const first = stream.next();
        await vi.advanceTimersByTimeAsync(0);
        child.stdout.push(Buffer.from([HEADER, assistantStart(), textDelta('partial')].join('\n') + '\n'));
        expect((await first).value).toBe('partial');

        let returned = false;
        const closing = stream.return(undefined).then(() => { returned = true; });
        await vi.advanceTimersByTimeAsync(PI_KILL_GRACE_MS - 1);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(returned).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await closing;
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(returned).toBe(true);
      });
    });

    it('wraps a spawn failure', async () => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      child.killed = false;
      child.kill = vi.fn();
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => {
          child.emit('error', new Error('spawn pi EACCES'));
          child.stdout.push(null);
        });
        return child;
      });
      const attempt = collect();
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/failed to start/);
    });

    it('applies the recursion guard and the version gate before spawning', async () => {
      await expect(collect({ env: { PATH: `${bin}:/usr/bin:/bin`, PI_CODING_AGENT: 'true' } })).rejects.toThrow(
        /pi is already the host/,
      );
      mockExecFile.mockImplementation((
        _path: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => cb(null, '0.70.0\n', ''));
      _resetPiVersionCache();
      await expect(collect()).rejects.toThrow(/too old/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('applies the resume check before spawning', async () => {
      const attempt = collect({ sessionId: '0b9d6c1e-6f0a-4b7e-9c55-2f3d1a4e8b10', resumeSession: true });
      await expect(attempt).rejects.toThrow(/not found/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('progress events', () => {
    it('maps tool_execution_start to an activity event', () => {
      expect(piEventsFromRecord({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'read',
        args: { path: 'src/relay.ts' },
      })).toEqual([{
        type: 'activity',
        message: 'Running: read src/relay.ts',
        data: { toolCallId: 'call_1', toolName: 'read' },
      }]);
    });

    it('picks a short, readable argument per tool and truncates long ones', () => {
      const message = (toolName: string, args: unknown): string =>
        piEventsFromRecord({ type: 'tool_execution_start', toolCallId: 'c', toolName, args })[0].message;
      expect(message('bash', { command: 'git   diff\n--stat' })).toBe('Running: bash git diff --stat');
      expect(message('grep', { pattern: 'TODO', path: 'src' })).toBe('Running: grep TODO src');
      expect(message('find', { pattern: '*.ts' })).toBe('Running: find *.ts');
      expect(message('ls', {})).toBe('Running: ls');
      expect(message('edit', { path: 'src/a.ts', oldText: 'OLD-SECRET', newText: 'NEW-SECRET' })).toBe('Running: edit src/a.ts');
      expect(message('write', { path: 'notes.md', content: 'FILE-CONTENTS' })).toBe('Running: write notes.md');
      const long = message('bash', { command: 'x'.repeat(500) });
      expect(long.length).toBeLessThan(240);
      expect(long.endsWith('…')).toBe(true);
    });

    it('names an unknown tool and nothing else, whatever its arguments hold', () => {
      // Only pi's built-in tools can run under PaF's allowlist, but the
      // summary must not depend on that: no allowlisted field, no detail.
      for (const args of [{ a: 1 }, { content: 'FILE-CONTENTS' }, { path: 'x', command: 'y', pattern: 'z' }, 'a string', null]) {
        expect(piEventsFromRecord({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'custom_tool', args })).toEqual([{
          type: 'activity',
          message: 'Running: custom_tool',
          data: { toolCallId: 'c', toolName: 'custom_tool' },
        }]);
      }
      const known = piEventsFromRecord({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'read', args: { path: 7, content: 'x' } });
      expect(known[0].message).toBe('Running: read');
    });

    it('reports an automatic retry', () => {
      expect(piEventsFromRecord({
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2000,
        errorMessage: 'Connection error.',
      })).toEqual([{
        type: 'activity',
        message: 'Retrying (1/3) after: Connection error.',
        data: { attempt: 1, maxAttempts: 3 },
      }]);
    });

    it('reports context compaction with its documented reason, and nothing else from the record', () => {
      for (const reason of ['manual', 'threshold', 'overflow']) {
        expect(piEventsFromRecord({ type: 'compaction_start', reason })).toEqual([{
          type: 'activity',
          message: `Compacting context (${reason})`,
          data: { reason },
        }]);
      }
      expect(piEventsFromRecord({ type: 'compaction_start', reason: 'x'.repeat(500) })).toEqual([{
        type: 'activity',
        message: 'Compacting context',
        data: { reason: null },
      }]);
      expect(piEventsFromRecord({ type: 'compaction_start' })[0].message).toBe('Compacting context');
      // The end record carries the summary of the conversation: never surfaced.
      expect(piEventsFromRecord({ type: 'compaction_end', reason: 'threshold', result: { summary: 'secret' } })).toEqual([]);
    });

    it('surfaces nothing for message, thinking or turn records', () => {
      expect(piEventsFromRecord({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'secret' } })).toEqual([]);
      expect(piEventsFromRecord({ type: 'turn_start' })).toEqual([]);
      expect(piEventsFromRecord({ type: 'tool_execution_end', toolName: 'read', isError: true })).toEqual([]);
      expect(piEventsFromRecord({ type: 'tool_execution_start' })).toEqual([]);
    });

    it('reports tool activity from runStream() when a listener is set', async () => {
      const events: BackendEvent[] = [];
      mockSpawn.mockReturnValue(chunkedChild(sliceBytes(fixture('tool-calls.jsonl'), 4096)));
      await collect({ onEvent: (event: BackendEvent) => events.push(event) });
      expect(events.map((event) => event.message)).toEqual([
        'Running: read created-by-pi.txt',
        'Running: read created-by-pi.txt',
      ]);
    });

    it('reports tool activity from the batch run() path too', async () => {
      const events: BackendEvent[] = [];
      mockSpawn.mockReturnValue(chunkedChild(sliceBytes(fixture('tool-calls.jsonl'), 4096)));
      await PI_BACKEND.run(makeOpts({ onEvent: (event: BackendEvent) => events.push(event) }));
      expect(events.map((event) => event.message)).toEqual([
        'Running: read created-by-pi.txt',
        'Running: read created-by-pi.txt',
      ]);
    });

    it('reports retries from run() before the run fails', async () => {
      const events: BackendEvent[] = [];
      mockSpawn.mockReturnValue(chunkedChild([fixture('retry-connection-error.jsonl')]));
      await expect(PI_BACKEND.run(makeOpts({ onEvent: (event: BackendEvent) => events.push(event) }))).rejects.toThrow(
        /Connection error/,
      );
      expect(events.map((event) => event.message)).toEqual([
        'Retrying (1/3) after: Connection error.',
        'Retrying (2/3) after: Connection error.',
        'Retrying (3/3) after: Connection error.',
      ]);
    });

    it('never lets a throwing listener break a run', async () => {
      mockSpawn.mockReturnValue(chunkedChild([fixture('tool-calls.jsonl')]));
      const onEvent = () => { throw new Error('observer bug'); };
      await expect(PI_BACKEND.run(makeOpts({ onEvent }))).resolves.toMatch(/^I was unable/);
      mockSpawn.mockReturnValue(chunkedChild([fixture('tool-calls.jsonl')]));
      expect((await collect({ onEvent })).join('')).toMatch(/^I was unable/);
    });
  });
});

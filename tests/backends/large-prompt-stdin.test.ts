/**
 * A prompt too large for one command-line argument on Linux (131,072 bytes and
 * up fail with `spawn E2BIG`) goes to Claude and Codex on stdin. Smaller
 * prompts keep the command line they always had.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ReviewOptions, SandboxMode } from '../../src/backends/index.js';

const { mockExecFileSync, mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync, execFile: mockExecFile, spawn: mockSpawn };
});

import {
  BackendError,
  STDIN_PROMPT_MIN_BYTES,
  SpawnCliError,
  largePromptStdin,
  spawnCli,
  spawnFailureMessage,
} from '../../src/backends/index.js';
import { CODEX_BACKEND } from '../../src/backends/codex.js';
import { CLAUDE_BACKEND } from '../../src/backends/claude.js';

const SMALL = 'Review this code';
const LARGE = 'x'.repeat(STDIN_PROMPT_MIN_BYTES);

interface FakeChild extends EventEmitter {
  stdin: PassThrough | null;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  received: () => string;
  stdinEnded: () => boolean;
}

/** A child whose stdin exists only when the caller asked for a pipe, as with a real spawn. */
function fakeChild(stdio: unknown): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const wantsStdin = Array.isArray(stdio) && stdio[0] === 'pipe';
  const chunks: Buffer[] = [];
  let ended = false;
  child.stdin = wantsStdin ? new PassThrough() : null;
  child.stdin?.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stdin?.on('end', () => { ended = true; });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn();
  child.received = () => Buffer.concat(chunks).toString();
  child.stdinEnded = () => ended;
  return child;
}

/** Spawn mock: every child prints `stdout`, exits with `code`, and is kept for inspection. */
function spawnReturning(stdout: string, code = 0, onSpawn?: (args: string[]) => void): FakeChild[] {
  const children: FakeChild[] = [];
  mockSpawn.mockImplementation((_cmd: string, args: string[], options: { stdio?: unknown }) => {
    const child = fakeChild(options?.stdio);
    children.push(child);
    setImmediate(() => {
      onSpawn?.(args);
      child.stdout.end(stdout);
      child.stderr.end();
      setImmediate(() => child.emit('close', code, null));
    });
    return child;
  });
  return children;
}

function stdioOf(callIndex = 0): unknown[] {
  return (mockSpawn.mock.calls[callIndex][2] as { stdio: unknown[] }).stdio;
}

function argsOf(callIndex = 0): string[] {
  return mockSpawn.mock.calls[callIndex][1] as string[];
}

beforeEach(() => {
  mockExecFileSync.mockReset();
  mockExecFile.mockReset();
  mockSpawn.mockReset();
  mockExecFileSync.mockImplementation((cmd: string) => {
    if (cmd === 'which') return '/usr/local/bin/tool';
    if (cmd === 'claude') return '2.1.322 (Claude Code)';
    return '';
  });
});

describe('largePromptStdin()', () => {
  it('leaves a prompt below the threshold as an argument', () => {
    expect(largePromptStdin('x'.repeat(STDIN_PROMPT_MIN_BYTES - 1))).toBeUndefined();
  });

  it('returns the prompt once it reaches the threshold', () => {
    expect(largePromptStdin(LARGE)).toBe(LARGE);
  });

  it('counts bytes, not characters', () => {
    // Three bytes each in UTF-8: a third of the threshold in characters is enough.
    const prompt = '€'.repeat(Math.ceil(STDIN_PROMPT_MIN_BYTES / 3));
    expect(prompt.length).toBeLessThan(STDIN_PROMPT_MIN_BYTES);
    expect(largePromptStdin(prompt)).toBe(prompt);
  });

  it('switches below the size Linux refuses for one argument', () => {
    expect(STDIN_PROMPT_MIN_BYTES).toBeLessThan(131_072);
  });
});

describe('spawnCli() stdin', () => {
  it('does not open stdin when there is nothing to write', async () => {
    spawnReturning('ok');
    await spawnCli('tool', ['a'], { timeoutMs: 5000 });
    expect(stdioOf()[0]).toBe('ignore');
  });

  it('writes the input and closes stdin', async () => {
    const children = spawnReturning('ok');
    const result = await spawnCli('tool', ['-'], { timeoutMs: 5000, stdin: LARGE });
    expect(result.stdout).toBe('ok');
    expect(stdioOf()[0]).toBe('pipe');
    expect(children[0].received()).toBe(LARGE);
    expect(children[0].stdinEnded()).toBe(true);
  });

  it('reports the exit status, not the broken pipe, when the child exits without reading', async () => {
    mockSpawn.mockImplementation((_cmd: string, _args: string[], options: { stdio?: unknown }) => {
      const child = fakeChild(options?.stdio);
      setImmediate(() => {
        child.stdin?.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
        child.stdout.end();
        child.stderr.end("error: unexpected argument '--nope' found");
        setImmediate(() => child.emit('close', 2, null));
      });
      return child;
    });

    const err = await spawnCli('tool', ['-'], { timeoutMs: 5000, stdin: LARGE }).catch((e) => e);
    expect(err).toBeInstanceOf(SpawnCliError);
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain('unexpected argument');
  });
});

describe('spawnFailureMessage()', () => {
  it('explains E2BIG and names the backends that accept a large prompt', () => {
    const message = spawnFailureMessage('gemini', Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' }));
    expect(message).toContain('gemini failed to start');
    expect(message).toContain('131,071 bytes');
    expect(message).toContain('--to claude, --to codex or --to grok');
  });

  it('keeps every other start failure as it was', () => {
    const message = spawnFailureMessage('codex exec', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
    expect(message).toBe('codex exec failed to start: spawn codex ENOENT');
  });

  it('is what spawnCli() rejects with when the command line is too long', async () => {
    mockSpawn.mockImplementation((_cmd: string, _args: string[], options: { stdio?: unknown }) => {
      const child = fakeChild(options?.stdio);
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' })));
      return child;
    });

    const err = await spawnCli('agy', ['--prompt', LARGE], { timeoutMs: 5000, label: 'antigravity' }).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.message).toContain('antigravity failed to start');
    expect(err.message).toContain('E2BIG');
    expect(err.message).toContain('shorter prompt');
  });

  it('is also what spawnCli() rejects with when spawn() itself throws, as Node does for E2BIG', async () => {
    mockSpawn.mockImplementation(() => {
      throw Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' });
    });

    const err = await spawnCli('gemini', ['--prompt', LARGE], { timeoutMs: 5000 }).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.message).toContain('gemini failed to start');
    expect(err.message).toContain('131,071 bytes');
    expect(err.message).not.toBe('spawn E2BIG');
  });
});

describe('Codex', () => {
  const base = {
    repoPath: '/tmp/repo',
    timeoutSeconds: 60,
    sandbox: 'read-only' as SandboxMode,
    model: null,
    env: {},
  };
  const writesAnswer = (args: string[]): void => {
    const flag = args.includes('--output-last-message') ? '--output-last-message' : '-o';
    fs.writeFileSync(args[args.indexOf(flag) + 1], 'Codex feedback');
  };

  it('passes a small prompt as the last argument with stdin closed', async () => {
    spawnReturning('', 0, writesAnswer);
    await CODEX_BACKEND.run({ ...base, prompt: SMALL });
    expect(argsOf().at(-1)).toBe(SMALL);
    expect(stdioOf()[0]).toBe('ignore');
  });

  it('sends a large prompt on stdin and passes "-" in its place', async () => {
    const children = spawnReturning('', 0, writesAnswer);
    const result = await CODEX_BACKEND.run({ ...base, prompt: LARGE });
    expect(result).toBe('Codex feedback');
    expect(argsOf().at(-1)).toBe('-');
    expect(argsOf()).not.toContain(LARGE);
    expect(stdioOf()[0]).toBe('pipe');
    expect(children[0].received()).toBe(LARGE);
  });

  it('does the same when resuming a thread', async () => {
    const children = spawnReturning('', 0, writesAnswer);
    await CODEX_BACKEND.run({ ...base, prompt: LARGE, sessionId: '019dd45f-aaaa', resumeSession: true });
    expect(argsOf().slice(0, 3)).toEqual(['exec', 'resume', '019dd45f-aaaa']);
    expect(argsOf().at(-1)).toBe('-');
    expect(children[0].received()).toBe(LARGE);
  });

  it('does the same for native review instructions', async () => {
    const children = spawnReturning('', 0, writesAnswer);
    await CODEX_BACKEND.review!({ ...base, prompt: LARGE, scope: 'working-tree' } as unknown as ReviewOptions);
    expect(argsOf().slice(0, 2)).toEqual(['exec', 'review']);
    expect(argsOf().at(-1)).toBe('-');
    expect(argsOf()).not.toContain(LARGE);
    expect(children[0].received()).toBe(LARGE);
  });

  it('opens no stdin for a native review that has no instructions', async () => {
    spawnReturning('', 0, writesAnswer);
    await CODEX_BACKEND.review!({ ...base, base: 'main' } as unknown as ReviewOptions);
    expect(argsOf()).not.toContain('-');
    expect(stdioOf()[0]).toBe('ignore');
  });
});

describe('Claude', () => {
  const base = {
    repoPath: '/tmp/repo',
    timeoutSeconds: 60,
    sandbox: 'read-only' as SandboxMode,
    model: null as string | null,
    env: {} as Record<string, string>,
  };

  it('passes a small prompt after -p with stdin closed', async () => {
    spawnReturning('Claude feedback');
    await CLAUDE_BACKEND.run({ ...base, prompt: SMALL });
    expect(argsOf().slice(0, 2)).toEqual(['-p', SMALL]);
    expect(stdioOf()[0]).toBe('ignore');
  });

  it('sends a large prompt on stdin and passes -p with no prompt', async () => {
    const children = spawnReturning('Claude feedback');
    const result = await CLAUDE_BACKEND.run({ ...base, prompt: LARGE });
    expect(result).toBe('Claude feedback');
    expect(argsOf()[0]).toBe('-p');
    expect(argsOf()[1].startsWith('-')).toBe(true);
    expect(argsOf()).not.toContain(LARGE);
    expect(stdioOf()[0]).toBe('pipe');
    expect(children[0].received()).toBe(LARGE);
    expect(children[0].stdinEnded()).toBe(true);
  });

  it('does the same when streaming', async () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Streamed answer' } },
    });
    const children = spawnReturning(`${line}\n`);

    const chunks: string[] = [];
    for await (const chunk of CLAUDE_BACKEND.runStream!({ ...base, prompt: LARGE })) chunks.push(chunk);

    expect(chunks.join('')).toBe('Streamed answer');
    expect(argsOf()[0]).toBe('-p');
    expect(argsOf()).not.toContain(LARGE);
    expect(stdioOf()[0]).toBe('pipe');
    expect(children[0].received()).toBe(LARGE);
  });

  it('explains a streamed start that spawn() refuses outright', async () => {
    // Reachable with a small prompt and another oversized argument, such as a huge schema.
    mockSpawn.mockImplementation(() => {
      throw Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' });
    });

    const err = await (async () => {
      for await (const _ of CLAUDE_BACKEND.runStream!({ ...base, prompt: SMALL })) { /* drain */ }
    })().catch((e) => e);

    expect(err).toBeInstanceOf(BackendError);
    expect(err.message).toContain('claude failed to start');
    expect(err.message).toContain('E2BIG');
    expect(err.message).not.toBe('spawn E2BIG');
  });

  it('keeps stdin closed for a small streamed prompt', async () => {
    spawnReturning('');
    for await (const _ of CLAUDE_BACKEND.runStream!({ ...base, prompt: SMALL })) { /* drain */ }
    expect(argsOf().slice(0, 2)).toEqual(['-p', SMALL]);
    expect(stdioOf()[0]).toBe('ignore');
  });
});

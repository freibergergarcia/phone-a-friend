import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

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
  CODEX_BACKEND,
  codexEventsFromLine,
  createCodexJsonlTap,
  extractCodexFinalMessage,
} from '../../src/backends/codex.js';
import type { BackendEvent, ReviewOptions } from '../../src/backends/index.js';

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

const line = (obj: unknown) => JSON.stringify(obj) + '\n';

describe('codexEventsFromLine', () => {
  it('links the backend session from thread.started', () => {
    expect(codexEventsFromLine(line({ type: 'thread.started', thread_id: 'thr-1' }))).toEqual([
      { type: 'session_linked', message: 'Codex thread thr-1', data: { backendSessionId: 'thr-1' } },
    ]);
  });

  it('reports command executions when they start and finish', () => {
    const started = codexEventsFromLine(line({
      type: 'item.started',
      item: { id: 'i1', type: 'command_execution', command: 'git status', aggregated_output: '', exit_code: null, status: 'in_progress' },
    }));
    expect(started).toEqual([{ type: 'activity', message: 'Running: git status', data: { itemId: 'i1', status: 'in_progress' } }]);
    const done = codexEventsFromLine(line({
      type: 'item.completed',
      item: { id: 'i1', type: 'command_execution', command: 'git status', aggregated_output: 'clean', exit_code: 0, status: 'completed' },
    }));
    expect(done).toEqual([{ type: 'activity', message: 'Finished (exit 0): git status', data: { itemId: 'i1', status: 'completed', exitCode: 0 } }]);
  });

  it('ignores command output updates and private reasoning', () => {
    expect(codexEventsFromLine(line({
      type: 'item.updated',
      item: { id: 'i1', type: 'command_execution', command: 'ls', aggregated_output: 'a', exit_code: null, status: 'in_progress' },
    }))).toEqual([]);
    expect(codexEventsFromLine(line({ type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'thinking' } }))).toEqual([]);
  });

  it('reports agent messages, file changes, tool calls, and web searches', () => {
    expect(codexEventsFromLine(line({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Looks good.' } })))
      .toEqual([{ type: 'message', message: 'Looks good.', data: { itemId: 'm1', length: 11 } }]);
    expect(codexEventsFromLine(line({ type: 'item.completed', item: { id: 'f1', type: 'file_change', changes: [{ path: 'a.ts', kind: 'update' }], status: 'completed' } })))
      .toEqual([{ type: 'activity', message: 'Changed 1 file(s)', data: { itemId: 'f1', status: 'completed', files: ['a.ts'] } }]);
    expect(codexEventsFromLine(line({ type: 'item.started', item: { id: 't1', type: 'mcp_tool_call', server: 'github', tool: 'get_pr', status: 'in_progress' } })))
      .toEqual([{ type: 'activity', message: 'Tool call: github/get_pr', data: { itemId: 't1', status: 'in_progress' } }]);
    expect(codexEventsFromLine(line({ type: 'item.started', item: { id: 'w1', type: 'web_search', query: 'sqlite wal' } })))
      .toEqual([{ type: 'activity', message: 'Web search: sqlite wal', data: { itemId: 'w1' } }]);
  });

  it('reports turn lifecycle and errors', () => {
    expect(codexEventsFromLine(line({ type: 'turn.started' }))).toEqual([{ type: 'turn_started', message: 'Codex turn started' }]);
    const usage = { input_tokens: 10, cached_input_tokens: 2, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 1 };
    expect(codexEventsFromLine(line({ type: 'turn.completed', usage })))
      .toEqual([{ type: 'turn_completed', message: 'Codex turn completed', data: { usage } }]);
    expect(codexEventsFromLine(line({ type: 'turn.failed', error: { message: 'quota exceeded' } })))
      .toEqual([{ type: 'turn_failed', message: 'Codex turn failed: quota exceeded' }]);
    expect(codexEventsFromLine(line({ type: 'error', message: 'stream reset' })))
      .toEqual([{ type: 'error', message: 'stream reset' }]);
    expect(codexEventsFromLine(line({ type: 'item.completed', item: { id: 'e1', type: 'error', message: 'tool crashed' } })))
      .toEqual([{ type: 'error', message: 'tool crashed', data: { itemId: 'e1' } }]);
  });

  it('truncates long commands and messages and ignores malformed lines', () => {
    const long = 'x'.repeat(500);
    const [cmd] = codexEventsFromLine(line({ type: 'item.started', item: { id: 'i', type: 'command_execution', command: long, aggregated_output: '', exit_code: null, status: 'in_progress' } }));
    expect(cmd.message.length).toBeLessThanOrEqual(220);
    expect(cmd.message.endsWith('…')).toBe(true);
    const [msg] = codexEventsFromLine(line({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text: long } }));
    expect(msg.message.length).toBeLessThanOrEqual(320);
    expect(msg.data).toEqual({ itemId: 'm', length: 500 });
    expect(codexEventsFromLine('not json\n')).toEqual([]);
    expect(codexEventsFromLine('')).toEqual([]);
  });
});

describe('createCodexJsonlTap', () => {
  it('buffers partial lines across chunks and emits events once per complete line', () => {
    const seen: BackendEvent[] = [];
    const tap = createCodexJsonlTap((e) => seen.push(e));
    const full = line({ type: 'thread.started', thread_id: 'thr-9' }) + line({ type: 'turn.started' });
    tap(full.slice(0, 12));
    expect(seen).toEqual([]);
    tap(full.slice(12));
    expect(seen.map((e) => e.type)).toEqual(['session_linked', 'turn_started']);
    tap.flush();
    expect(seen).toHaveLength(2);
  });

  it('flush() drains a trailing line without a newline', () => {
    const seen: BackendEvent[] = [];
    const tap = createCodexJsonlTap((e) => seen.push(e));
    tap(JSON.stringify({ type: 'turn.started' }));
    expect(seen).toEqual([]);
    tap.flush();
    expect(seen.map((e) => e.type)).toEqual(['turn_started']);
  });
});

describe('extractCodexFinalMessage', () => {
  it('returns the text of the last completed agent message', () => {
    const jsonl = line({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'first' } })
      + line({ type: 'item.completed', item: { id: 'b', type: 'reasoning', text: 'hmm' } })
      + line({ type: 'item.completed', item: { id: 'c', type: 'agent_message', text: 'final answer' } })
      + line({ type: 'turn.completed', usage: {} });
    expect(extractCodexFinalMessage(jsonl)).toBe('final answer');
  });

  it('returns an empty string when no agent message exists', () => {
    expect(extractCodexFinalMessage(line({ type: 'turn.started' }) + 'garbage\n')).toBe('');
  });
});

describe('CodexBackend review() progress', () => {
  const baseReviewOpts: ReviewOptions = {
    repoPath: '/tmp/repo',
    timeoutSeconds: 60,
    sandbox: 'read-only',
    model: null,
    env: {},
    base: 'main',
  };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    mockExecFileSync.mockImplementation((cmd: string) => (cmd === 'which' ? '/usr/local/bin/codex' : ''));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests JSONL output and streams events to onEvent while the review runs', async () => {
    const seen: BackendEvent[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        child.stdout.write(line({ type: 'thread.started', thread_id: 'thr-42' }));
        child.stdout.write(line({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'git diff', aggregated_output: '', exit_code: null, status: 'in_progress' } }));
        // The observer must have seen the first events before the process exits.
        expect(seen.map((e) => e.type)).toEqual(['session_linked', 'activity']);
        child.stdout.write(line({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Review feedback' } }));
        child.stdout.write(line({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }));
        fs.writeFileSync(args[outputIdx], 'Review feedback');
        child.stdout.end();
        child.emit('close', 0, null);
      });
      return child;
    });

    const result = await CODEX_BACKEND.review!({ ...baseReviewOpts, onEvent: (e) => seen.push(e) });
    expect(result).toBe('Review feedback');
    const args = mockSpawn.mock.calls.find((c: unknown[]) => c[0] === 'codex')![1] as string[];
    expect(args).toContain('--json');
    expect(seen.map((e) => e.type)).toEqual(['session_linked', 'activity', 'message', 'turn_completed']);
    expect(seen[0].data).toEqual({ backendSessionId: 'thr-42' });
  });

  it('falls back to the final agent message instead of raw JSONL when the output file is missing', async () => {
    mockSpawn.mockImplementation(() => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stdout.write(line({ type: 'thread.started', thread_id: 'thr-1' }));
        child.stdout.write(line({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Only in JSONL' } }));
        child.stdout.end();
        child.emit('close', 0, null);
      });
      return child;
    });
    const result = await CODEX_BACKEND.review!({ ...baseReviewOpts, onEvent: () => {} });
    expect(result).toBe('Only in JSONL');
  });

  it('does not request JSONL when nobody is listening', async () => {
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        fs.writeFileSync(args[outputIdx], 'plain');
        child.stdout.end();
        child.emit('close', 0, null);
      });
      return child;
    });
    await CODEX_BACKEND.review!(baseReviewOpts);
    const args = mockSpawn.mock.calls.find((c: unknown[]) => c[0] === 'codex')![1] as string[];
    expect(args).not.toContain('--json');
  });
});

describe('CodexBackend run() progress', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    mockExecFileSync.mockImplementation((cmd: string) => (cmd === 'which' ? '/usr/local/bin/codex' : ''));
  });

  it('adds --json and streams events when onEvent is provided to a plain run', async () => {
    const seen: BackendEvent[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const child = fakeChild();
      const outputIdx = args.indexOf('--output-last-message') + 1;
      process.nextTick(() => {
        child.stdout.write(line({ type: 'thread.started', thread_id: 'thr-7' }));
        child.stdout.write(line({ type: 'turn.completed', usage: {} }));
        fs.writeFileSync(args[outputIdx], 'answer');
        child.stdout.end();
        child.emit('close', 0, null);
      });
      return child;
    });
    const result = await CODEX_BACKEND.run({
      prompt: 'hi', repoPath: '/tmp/repo', timeoutSeconds: 60, sandbox: 'read-only', model: null, env: {},
      onEvent: (e) => seen.push(e),
    });
    expect(result).toBe('answer');
    const args = mockSpawn.mock.calls.find((c: unknown[]) => c[0] === 'codex')![1] as string[];
    expect(args).toContain('--json');
    expect(seen.map((e) => e.type)).toEqual(['session_linked', 'turn_completed']);
  });
});

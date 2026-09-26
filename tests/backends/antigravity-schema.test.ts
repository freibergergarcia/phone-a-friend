import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

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
  buildAntigravityArgs,
  sanitizeAntigravitySchema,
} from '../../src/backends/antigravity.js';

function fakeChild(exitCode = 0, stdout = '', stderr = '') {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void; killed: boolean };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn();
  process.nextTick(() => {
    if (stdout) child.stdout.write(stdout);
    child.stdout.end();
    if (stderr) child.stderr.write(stderr);
    child.stderr.end();
    child.emit('close', exitCode, null);
  });
  return child;
}

const SCHEMA = '{"type":"object","properties":{"ok":{"type":"boolean"},"word":{"type":"string"}},"required":["ok","word"]}';

// Envelope captured live from agy 1.2.11 with --output-format json --json-schema
// (2026-09-26). `response` carries extra keys the model added; the clean
// value is under `structured_output`.
const LIVE_ENVELOPE = {
  conversation_id: '918c0002-0f88-4a39-bd93-5f65da863f22',
  status: 'SUCCESS',
  response: '{"ok":true,"toolAction":"Finishing task","toolSummary":"Finish task with ok=true and word=PONG","word":"PONG"}\n',
  duration_seconds: 43.47,
  num_turns: 1,
  structured_output: { ok: true, word: 'PONG' },
  json_schema: JSON.parse(SCHEMA),
};

const baseOpts = {
  prompt: 'Return ok=true and word=PONG.',
  repoPath: '/repo',
  sandbox: 'read-only' as const,
  model: null,
  timeoutSeconds: 60,
  env: {},
  schema: SCHEMA,
};

describe('Antigravity native --json-schema', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    mockExecFileSync.mockReturnValue('/usr/local/bin/agy');
  });

  it('passes the schema natively and requests the JSON envelope, without a prompt suffix', () => {
    const args = buildAntigravityArgs({
      prompt: 'p', repoPath: '/repo', sandbox: 'read-only', model: null, timeoutSeconds: 60, schema: SCHEMA,
    });
    expect(args).toContain('--json-schema');
    expect(args[args.indexOf('--json-schema') + 1]).toBe(SCHEMA);
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'json']);
    expect(args[args.length - 1]).toBe('p');
  });

  it('does not change the one-shot vector when no schema is set', () => {
    expect(buildAntigravityArgs({ prompt: 'p', repoPath: '/repo', sandbox: 'read-only', model: null, timeoutSeconds: 60 }))
      .toEqual(['--add-dir', '/repo', '--print-timeout', '60s', '--sandbox', '--mode', 'plan', '--prompt', 'p']);
  });

  it('returns the structured_output value as JSON text', async () => {
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify(LIVE_ENVELOPE)));
    expect(await ANTIGRAVITY_BACKEND.run(baseOpts)).toBe('{"ok":true,"word":"PONG"}');
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[args.length - 1]).toBe(baseOpts.prompt);
  });

  it.each([
    ['scalar', 42, '42'],
    ['array', [1, 2], '[1,2]'],
    ['null', null, 'null'],
  ])('returns a %s structured_output verbatim', async (_name, value, expected) => {
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify({ ...LIVE_ENVELOPE, structured_output: value })));
    expect(await ANTIGRAVITY_BACKEND.run(baseOpts)).toBe(expected);
  });

  it('falls back to response when structured_output is absent', async () => {
    const { structured_output: _omit, ...withoutStructured } = LIVE_ENVELOPE;
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify(withoutStructured)));
    expect(await ANTIGRAVITY_BACKEND.run(baseOpts)).toBe(LIVE_ENVELOPE.response);
  });

  it('rejects a non-SUCCESS envelope in schema mode, reading the detail like session mode does', async () => {
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify({ ...LIVE_ENVELOPE, status: 'ERROR', response: '', error: 'quota' })));
    await expect(ANTIGRAVITY_BACKEND.run(baseOpts)).rejects.toThrow(/status: ERROR: quota/);
  });

  it('rejects an empty response in schema mode even if structured_output is present', async () => {
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify({ ...LIVE_ENVELOPE, response: '' })));
    await expect(ANTIGRAVITY_BACKEND.run(baseOpts)).rejects.toThrow(/without producing a response/);
  });

  it('rejects a print-timeout partial result in schema mode', async () => {
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify(LIVE_ENVELOPE),
      '[agy] print timeout after 3s with turn in progress; returning partial output\n'));
    await expect(ANTIGRAVITY_BACKEND.run(baseOpts)).rejects.toThrow(/returned partial output/);
  });

  it('keeps every session guard in schema + session mode', async () => {
    const onSessionCreated = vi.fn();
    // Resume mismatch: no callback, error names both ids.
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify({ ...LIVE_ENVELOPE, conversation_id: 'other' })));
    const err = await ANTIGRAVITY_BACKEND.run({ ...baseOpts, resumeSession: true, sessionId: 'mine', onSessionCreated }).catch((e) => e);
    expect(err).toBeInstanceOf(AntigravityBackendError);
    expect(err.message).toContain('did not resume conversation mine');
    expect(onSessionCreated).not.toHaveBeenCalled();

    // Missing conversation_id on a persisting call: error, no callback.
    const { conversation_id: _omit, ...noId } = LIVE_ENVELOPE;
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify(noId)));
    await expect(ANTIGRAVITY_BACKEND.run({ ...baseOpts, persistSession: true, onSessionCreated })).rejects.toThrow(/without a conversation_id/);
    expect(onSessionCreated).not.toHaveBeenCalled();

    // Healthy: callback fires with the id and the structured value is returned.
    mockSpawn.mockImplementation(() => fakeChild(0, JSON.stringify(LIVE_ENVELOPE)));
    expect(await ANTIGRAVITY_BACKEND.run({ ...baseOpts, persistSession: true, onSessionCreated })).toBe('{"ok":true,"word":"PONG"}');
    expect(onSessionCreated).toHaveBeenCalledWith(LIVE_ENVELOPE.conversation_id);
  });

  it('keeps the stderr tail on schema-mode errors', async () => {
    mockSpawn.mockImplementation(() => fakeChild(0, '', 'x'.repeat(3000) + 'TAIL'));
    const err = await ANTIGRAVITY_BACKEND.run(baseOpts).catch((e) => e);
    expect(err.message).toMatch(/TAIL$/);
    expect(err.message.split('stderr: ')[1].length).toBeLessThan(2100);
  });
});

describe('Antigravity schema sanitising', () => {
  it('drops enums whose values are not all strings, which the Gemini API rejects', () => {
    // Live on agy 1.2.11: the verdict schema's `schema_version` enum [1]
    // failed with INVALID_ARGUMENT "enum[0]: cannot be empty". PaF validates
    // the parsed value itself, so the constraint is dropped, not the field.
    const input = {
      type: 'object',
      properties: {
        schema_version: { type: 'integer', enum: [1] },
        verdict: { type: 'string', enum: ['ship', 'iterate'] },
        findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['nit'] }, level: { type: 'number', enum: [1, 2] } } } },
      },
    };
    expect(JSON.parse(sanitizeAntigravitySchema(JSON.stringify(input)))).toEqual({
      type: 'object',
      properties: {
        schema_version: { type: 'integer' },
        verdict: { type: 'string', enum: ['ship', 'iterate'] },
        findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['nit'] }, level: { type: 'number' } } } },
      },
    });
  });

  it('returns unparseable schema text unchanged so agy reports the problem', () => {
    expect(sanitizeAntigravitySchema('{not json')).toBe('{not json');
  });

  it('is applied to the --json-schema argument', () => {
    const args = buildAntigravityArgs({
      prompt: 'p', repoPath: '/repo', sandbox: 'read-only', model: null, timeoutSeconds: 60,
      schema: '{"type":"object","properties":{"v":{"type":"integer","enum":[1]}}}',
    });
    expect(args[args.indexOf('--json-schema') + 1]).toBe('{"type":"object","properties":{"v":{"type":"integer"}}}');
  });
});

describe('Antigravity headless prompt preamble', () => {
  it('prefixes the no-shell instruction for relay and review', () => {
    const prepared = ANTIGRAVITY_BACKEND.preparePrompt!('Request:\nreview this', { mode: 'review' });
    expect(prepared.startsWith('This is a headless session')).toBe(true);
    expect(prepared).toMatch(/shell and terminal commands are auto-denied/);
    expect(prepared.endsWith('Request:\nreview this')).toBe(true);
    expect(ANTIGRAVITY_BACKEND.preparePrompt!('x', { mode: 'relay' })).toContain('file-viewing tools');
  });
});

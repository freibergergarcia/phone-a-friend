import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { buildGeminiArgs, GEMINI_BACKEND, GeminiBackendError } from '../../src/backends/gemini.js';

function fakeChild(exitCode: number, stdout: string, stderr: string) {
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

function args(sandbox: SandboxMode): string[] {
  return buildGeminiArgs({
    prompt: 'p', repoPath: '/repo', sandbox, model: null, useJsonOutput: false, sessionId: null, resumeSession: false,
  });
}

/**
 * Gemini CLI 0.50.0 `--help`: `--approval-mode` with choices default,
 * auto_edit, yolo, plan ("read-only mode"); `--yolo` is documented as
 * deprecated in favour of `--approval-mode=yolo`. PaF used to send
 * `--sandbox --yolo` for read-only, which auto-approved edits.
 */
describe('Gemini approval mode per sandbox', () => {
  it('read-only maps to --approval-mode plan, never --yolo', () => {
    const a = args('read-only');
    expect(a).toContain('--sandbox');
    expect(a.slice(a.indexOf('--approval-mode'), a.indexOf('--approval-mode') + 2)).toEqual(['--approval-mode', 'plan']);
    expect(a).not.toContain('--yolo');
  });

  it('workspace-write maps to --approval-mode auto_edit, never --yolo', () => {
    const a = args('workspace-write');
    expect(a).toContain('--sandbox');
    expect(a.slice(a.indexOf('--approval-mode'), a.indexOf('--approval-mode') + 2)).toEqual(['--approval-mode', 'auto_edit']);
    expect(a).not.toContain('--yolo');
  });

  it('danger-full-access keeps --yolo and no sandbox, as before', () => {
    const a = args('danger-full-access');
    expect(a).toContain('--yolo');
    expect(a).not.toContain('--sandbox');
    expect(a).not.toContain('--approval-mode');
  });

  it('keeps the rest of the vector unchanged', () => {
    expect(args('read-only')).toEqual([
      '--sandbox', '--approval-mode', 'plan', '--include-directories', '/repo', '--output-format', 'text', '--prompt', 'p',
    ]);
  });
});

describe('Gemini auth and flag errors', () => {
  const opts = {
    prompt: 'p', repoPath: '/repo', timeoutSeconds: 30, sandbox: 'read-only' as SandboxMode, model: null, env: {},
  };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    mockExecFileSync.mockReturnValue('/usr/local/bin/gemini');
  });

  it('turns the retired individual sign-in error into an actionable one', async () => {
    // Captured live from gemini 0.50.0 on 2026-09-26.
    mockSpawn.mockImplementation(() => fakeChild(1, '',
      'Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. ' +
      'To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google\n'));
    const err = await GEMINI_BACKEND.run(opts).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiBackendError);
    expect(err.message).toMatch(/no longer supported for Gemini Code Assist/);
    expect(err.message).toMatch(/GEMINI_API_KEY/);
    expect(err.message).toMatch(/--to antigravity/);
  });

  it('passes other authentication failures through untouched', async () => {
    mockSpawn.mockImplementation(() => fakeChild(1, '', 'Error authenticating: token expired\n'));
    const err = await GEMINI_BACKEND.run(opts).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiBackendError);
    expect(err.message).toBe('Error authenticating: token expired');
  });

  it('explains when the installed CLI does not know --approval-mode', async () => {
    mockSpawn.mockImplementation(() => fakeChild(1, '', 'Unknown argument: approval-mode\n'));
    const err = await GEMINI_BACKEND.run(opts).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiBackendError);
    expect(err.message).toMatch(/--approval-mode/);
    expect(err.message).toMatch(/Upgrade/);
  });
});

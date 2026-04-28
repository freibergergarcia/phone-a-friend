/**
 * Tests for ClaudeBackend — subprocess backend using the `claude` CLI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { SandboxMode } from '../../src/backends/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockExecFileSync, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync, spawn: mockSpawn };
});

import { CLAUDE_BACKEND, ClaudeBackendError } from '../../src/backends/claude.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Create a mock child process for spawn() */
function mockChildProcess(
  stdout: string,
  exitCode = 0,
  opts?: { stderr?: string; signal?: string },
) {
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

  // Emit close after stdout ends
  stdoutStream.on('end', () => {
    const sig = opts?.signal ?? null;
    child.exitCode = sig ? null : exitCode;
    process.nextTick(() => child.emit('close', sig ? null : exitCode, sig));
  });

  return child;
}

/** Create a mock child that never completes (for timeout tests) */
function mockHangingChild() {
  const stdoutStream = new Readable({ read() {} });
  const stderrStream = new Readable({ read() {} });
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
  child.kill = vi.fn(() => {
    child.killed = true;
    // Simulate OS behavior: end streams and emit close on kill
    stdoutStream.push(null);
    stderrStream.push(null);
    process.nextTick(() => child.emit('close', null, 'SIGTERM'));
  });

  return child;
}

// ---------------------------------------------------------------------------
// Tests — run()
// ---------------------------------------------------------------------------

describe('ClaudeBackend', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and allowed sandboxes', () => {
    expect(CLAUDE_BACKEND.name).toBe('claude');
    expect(CLAUDE_BACKEND.localFileAccess).toBe(true);
    expect(CLAUDE_BACKEND.allowedSandboxes.has('read-only')).toBe(true);
    expect(CLAUDE_BACKEND.allowedSandboxes.has('workspace-write')).toBe(true);
    expect(CLAUDE_BACKEND.allowedSandboxes.has('danger-full-access')).toBe(true);
  });

  it('builds correct args for read-only sandbox', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('Claude feedback', 0));

    const result = await CLAUDE_BACKEND.run(makeOpts());

    expect(result).toBe('Claude feedback');

    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall[0]).toBe('claude');
    const args = spawnCall[1] as string[];
    const spawnOpts = spawnCall[2] as Record<string, unknown>;

    // Print mode
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe('Review this code');

    // Repo access
    expect(args).toContain('--add-dir');
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/tmp/repo');

    // Output format
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('text');

    // Tools (read-only)
    expect(args).toContain('--tools');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,LS,WebFetch,WebSearch');

    // AllowedTools (auto-approve, same as tools)
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob,LS,WebFetch,WebSearch');

    // Depth guard
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--disallowedTools');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('Task');

    // Ephemeral
    expect(args).toContain('--no-session-persistence');

    // Max turns default
    expect(args).toContain('--max-turns');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('10');

    // cwd set to repo path
    expect(spawnOpts.cwd).toBe('/tmp/repo');

    // No --dangerously-skip-permissions
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('builds correct args for workspace-write sandbox', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({ sandbox: 'workspace-write' }));

    const args = mockSpawn.mock.calls[0][1] as string[];

    expect(args).toContain('--tools');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,LS,Edit,Write,WebFetch,WebSearch');
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob,LS,Edit,Write,WebFetch,WebSearch');

    // No Bash in workspace-write
    expect(args[args.indexOf('--tools') + 1]).not.toContain('Bash');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('uses --dangerously-skip-permissions for danger-full-access', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({ sandbox: 'danger-full-access' }));

    const args = mockSpawn.mock.calls[0][1] as string[];

    expect(args).toContain('--dangerously-skip-permissions');
    // Should NOT have --tools or --allowedTools
    expect(args).not.toContain('--tools');
    expect(args).not.toContain('--allowedTools');
  });

  it('passes --model when model is provided', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('opus feedback', 0));

    await CLAUDE_BACKEND.run(makeOpts({ model: 'opus' }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    const modelIdx = args.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('opus');
  });

  it('passes --json-schema and json output format when schema is provided', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('{"ok":true}', 0));

    await CLAUDE_BACKEND.run(makeOpts({ schema: '{"type":"object"}' }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args).toContain('--json-schema');
    expect(args[args.indexOf('--json-schema') + 1]).toBe('{"type":"object"}');
  });

  it('does not pass --bare when fast mode is enabled', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({ fast: true }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain('--bare');
  });

  it('starts a persisted session with --session-id and without --no-session-persistence', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({
      sessionId: 'uuid-1',
      persistSession: true,
    }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('uuid-1');
    expect(args).not.toContain('--no-session-persistence');
  });

  it('resumes a persisted session with -r', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({
      sessionId: 'uuid-1',
      persistSession: true,
      resumeSession: true,
    }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('-r');
    expect(args[args.indexOf('-r') + 1]).toBe('uuid-1');
    expect(args).not.toContain('--add-dir');
  });

  it('does not pass --model when model is null', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({ model: null }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain('--model');
  });

  it('passes CLAUDE_MAX_TURNS from env', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({ env: { CLAUDE_MAX_TURNS: '5' } }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf('--max-turns') + 1]).toBe('5');
  });

  it('passes CLAUDE_MAX_BUDGET from env', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({ env: { CLAUDE_MAX_BUDGET: '3.50' } }));

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--max-budget-usd');
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('3.50');
  });

  it('throws ClaudeBackendError when claude not found in PATH', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') throw new Error('not found');
      return '';
    });

    await expect(
      CLAUDE_BACKEND.run(makeOpts()),
    ).rejects.toThrow(/claude CLI not found/);
  });

  it('throws on timeout', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockHangingChild());

    await expect(
      CLAUDE_BACKEND.run(makeOpts({ timeoutSeconds: 0.01 })),
    ).rejects.toThrow(/timed out/);
  });

  it('throws on non-zero exit code with stderr', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('', 1, { stderr: 'API error: rate limited' }));

    await expect(
      CLAUDE_BACKEND.run(makeOpts()),
    ).rejects.toThrow('API error: rate limited');
  });

  it('strips CLAUDECODE and CLAUDE_CODE_SESSION from subprocess env', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('ok', 0));

    await CLAUDE_BACKEND.run(makeOpts({
      env: {
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION: 'abc-123',
        PATH: '/usr/bin',
        HOME: '/home/user',
      },
    }));

    const spawnEnv = (mockSpawn.mock.calls[0][2] as Record<string, unknown>).env as Record<string, string>;
    expect(spawnEnv).not.toHaveProperty('CLAUDECODE');
    expect(spawnEnv).not.toHaveProperty('CLAUDE_CODE_SESSION');
    expect(spawnEnv).toHaveProperty('PATH', '/usr/bin');
    expect(spawnEnv).toHaveProperty('HOME', '/home/user');
  });

  it('strips nested-session env vars in runStream()', async () => {
    const lines = [
      JSON.stringify({ type: 'result', result: 'ok' }),
      '',
    ].join('\n');

    const child = mockChildProcess(lines, 0);
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(child);

    for await (const _ of CLAUDE_BACKEND.runStream!(makeOpts({
      env: {
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION: 'xyz',
        PATH: '/usr/bin',
      },
    }))) {
      // consume
    }

    const spawnCall = mockSpawn.mock.calls[0];
    const spawnEnv = (spawnCall[2] as Record<string, unknown>).env as Record<string, string>;
    expect(spawnEnv).not.toHaveProperty('CLAUDECODE');
    expect(spawnEnv).not.toHaveProperty('CLAUDE_CODE_SESSION');
    expect(spawnEnv).toHaveProperty('PATH', '/usr/bin');
  });

  it('throws when claude produces no output', async () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
    mockSpawn.mockReturnValue(mockChildProcess('', 0));

    await expect(
      CLAUDE_BACKEND.run(makeOpts()),
    ).rejects.toThrow(/without producing output/);
  });

  // -----------------------------------------------------------------------
  // Tests — runStream()
  // -----------------------------------------------------------------------

  describe('runStream()', () => {
    it('streams content from assistant messages', async () => {
      const lines = [
        JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'Hello' }] }),
        JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }),
        JSON.stringify({ type: 'result', result: 'Hello world' }),
        '',
      ].join('\n');

      const child = mockChildProcess(lines, 0);
      mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
      mockSpawn.mockReturnValue(child);

      const chunks: string[] = [];
      for await (const chunk of CLAUDE_BACKEND.runStream!(makeOpts())) {
        chunks.push(chunk);
      }

      // De-duplication: "Hello" then " world" (delta)
      expect(chunks.join('')).toBe('Hello world');
    });

    it('uses stream-json output format and --include-partial-messages', async () => {
      const lines = [
        JSON.stringify({ type: 'result', result: 'hi' }),
        '',
      ].join('\n');

      const child = mockChildProcess(lines, 0);
      mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
      mockSpawn.mockReturnValue(child);

      const chunks: string[] = [];
      for await (const chunk of CLAUDE_BACKEND.runStream!(makeOpts())) {
        chunks.push(chunk);
      }

      const spawnCall = mockSpawn.mock.calls[0];
      const args = spawnCall[1] as string[];
      expect(args).toContain('--output-format');
      expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
      expect(args).toContain('--include-partial-messages');
    });

    it('throws ClaudeBackendError when claude not found (stream)', async () => {
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') throw new Error('not found');
        return '';
      });

      const gen = CLAUDE_BACKEND.runStream!(makeOpts());
      await expect(gen.next()).rejects.toThrow(/claude CLI not found/);
    });

    it('handles stream errors', async () => {
      const lines = [
        JSON.stringify({ error: { message: 'overloaded' } }),
        '',
      ].join('\n');

      const child = mockChildProcess(lines, 1);
      mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
      mockSpawn.mockReturnValue(child);

      const gen = CLAUDE_BACKEND.runStream!(makeOpts());
      await expect(gen.next()).rejects.toThrow(/stream error/i);
    });

    it('sets cwd to repoPath in spawn options', async () => {
      const lines = [
        JSON.stringify({ type: 'result', result: 'ok' }),
        '',
      ].join('\n');

      const child = mockChildProcess(lines, 0);
      mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
      mockSpawn.mockReturnValue(child);

      for await (const _ of CLAUDE_BACKEND.runStream!(makeOpts())) {
        // consume
      }

      const spawnCall = mockSpawn.mock.calls[0];
      const opts = spawnCall[2] as Record<string, unknown>;
      expect(opts.cwd).toBe('/tmp/repo');
    });

    it('reports non-zero exit code with stderr content', async () => {
      const lines = [
        JSON.stringify({ type: 'result', result: 'partial' }),
        '',
      ].join('\n');

      const child = mockChildProcess(lines, 1, { stderr: 'API error: rate limited' });
      mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
      mockSpawn.mockReturnValue(child);

      const gen = CLAUDE_BACKEND.runStream!(makeOpts());
      await expect(async () => {
        for await (const _ of gen) { /* consume */ }
      }).rejects.toThrow('API error: rate limited');
    });

    it('reports signal kill as error', async () => {
      const lines = [
        JSON.stringify({ type: 'result', result: 'ok' }),
        '',
      ].join('\n');

      const child = mockChildProcess(lines, 0, { signal: 'SIGKILL' });
      mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
      mockSpawn.mockReturnValue(child);

      const gen = CLAUDE_BACKEND.runStream!(makeOpts());
      await expect(async () => {
        for await (const _ of gen) { /* consume */ }
      }).rejects.toThrow(/killed by signal SIGKILL/);
    });
  });
});

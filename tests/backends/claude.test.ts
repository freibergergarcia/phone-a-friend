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
  const stdoutStream = Readable.from([stdout]);
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
    let observedOpts: Record<string, unknown> = {};

    mockExecFileSync.mockImplementation(
      (cmd: string, _args: string[], opts?: Record<string, unknown>) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        observedOpts = opts ?? {};
        return 'Claude feedback';
      },
    );

    const result = await CLAUDE_BACKEND.run(makeOpts());

    expect(result).toBe('Claude feedback');

    const claudeCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'claude',
    );
    expect(claudeCall).toBeDefined();
    const args = claudeCall![1] as string[];

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
    expect(observedOpts.cwd).toBe('/tmp/repo');

    // No --dangerously-skip-permissions
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('builds correct args for workspace-write sandbox', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return 'ok';
    });

    await CLAUDE_BACKEND.run(makeOpts({ sandbox: 'workspace-write' }));

    const claudeCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'claude',
    );
    const args = claudeCall![1] as string[];

    expect(args).toContain('--tools');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,LS,Edit,Write,WebFetch,WebSearch');
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob,LS,Edit,Write,WebFetch,WebSearch');

    // No Bash in workspace-write
    expect(args[args.indexOf('--tools') + 1]).not.toContain('Bash');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('uses --dangerously-skip-permissions for danger-full-access', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return 'ok';
    });

    await CLAUDE_BACKEND.run(makeOpts({ sandbox: 'danger-full-access' }));

    const claudeCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'claude',
    );
    const args = claudeCall![1] as string[];

    expect(args).toContain('--dangerously-skip-permissions');
    // Should NOT have --tools or --allowedTools
    expect(args).not.toContain('--tools');
    expect(args).not.toContain('--allowedTools');
  });

  it('passes --model when model is provided', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return 'opus feedback';
    });

    await CLAUDE_BACKEND.run(makeOpts({ model: 'opus' }));

    const claudeCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'claude',
    );
    const args = claudeCall![1] as string[];
    const modelIdx = args.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('opus');
  });

  it('does not pass --model when model is null', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return 'ok';
    });

    await CLAUDE_BACKEND.run(makeOpts({ model: null }));

    const claudeCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'claude',
    );
    const args = claudeCall![1] as string[];
    expect(args).not.toContain('--model');
  });

  it('passes CLAUDE_MAX_TURNS from env', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return 'ok';
    });

    await CLAUDE_BACKEND.run(makeOpts({ env: { CLAUDE_MAX_TURNS: '5' } }));

    const claudeCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'claude',
    );
    const args = claudeCall![1] as string[];
    expect(args[args.indexOf('--max-turns') + 1]).toBe('5');
  });

  it('passes CLAUDE_MAX_BUDGET from env', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return 'ok';
    });

    await CLAUDE_BACKEND.run(makeOpts({ env: { CLAUDE_MAX_BUDGET: '3.50' } }));

    const claudeCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) => c[0] === 'claude',
    );
    const args = claudeCall![1] as string[];
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
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      const err = new Error('TIMEOUT') as Error & {
        killed: boolean;
        signal: string;
        code: string;
      };
      err.killed = true;
      err.signal = 'SIGTERM';
      err.code = 'ETIMEDOUT';
      throw err;
    });

    await expect(
      CLAUDE_BACKEND.run(makeOpts({ timeoutSeconds: 10 })),
    ).rejects.toThrow(/timed out after 10s/);
  });

  it('throws on non-zero exit code with stderr', async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      const err = new Error('command failed') as Error & {
        status: number;
        stdout: Buffer;
        stderr: Buffer;
      };
      err.status = 1;
      err.stdout = Buffer.from('');
      err.stderr = Buffer.from('API error: rate limited');
      throw err;
    });

    await expect(
      CLAUDE_BACKEND.run(makeOpts()),
    ).rejects.toThrow('API error: rate limited');
  });

  it('strips CLAUDECODE and CLAUDE_CODE_SESSION from subprocess env', async () => {
    let observedEnv: Record<string, string> = {};

    mockExecFileSync.mockImplementation(
      (cmd: string, _args: string[], opts?: Record<string, unknown>) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        observedEnv = (opts?.env ?? {}) as Record<string, string>;
        return 'ok';
      },
    );

    await CLAUDE_BACKEND.run(makeOpts({
      env: {
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION: 'abc-123',
        PATH: '/usr/bin',
        HOME: '/home/user',
      },
    }));

    expect(observedEnv).not.toHaveProperty('CLAUDECODE');
    expect(observedEnv).not.toHaveProperty('CLAUDE_CODE_SESSION');
    expect(observedEnv).toHaveProperty('PATH', '/usr/bin');
    expect(observedEnv).toHaveProperty('HOME', '/home/user');
  });

  it('strips nested-session env vars in runStream()', async () => {
    const lines = [
      JSON.stringify({ type: 'result', result: 'ok' }),
      '',
    ].join('\n');

    const child = mockChildProcess(lines, 0);
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });
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
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

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
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        return '';
      });
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
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        return '';
      });
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
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        return '';
      });
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
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        return '';
      });
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
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        return '';
      });
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
      mockExecFileSync.mockImplementation((cmd: string) => {
        if (cmd === 'which') return '/usr/local/bin/claude';
        return '';
      });
      mockSpawn.mockReturnValue(child);

      const gen = CLAUDE_BACKEND.runStream!(makeOpts());
      await expect(async () => {
        for await (const _ of gen) { /* consume */ }
      }).rejects.toThrow(/killed by signal SIGKILL/);
    });
  });
});

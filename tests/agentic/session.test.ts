/**
 * Tests for agentic SessionManager — Claude subprocess management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock child_process.spawn
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Mock crypto.randomUUID for deterministic session IDs
vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { SessionManager } from '../../src/agentic/session.js';
import type { AgentConfig } from '../../src/agentic/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'reviewer',
    backend: 'claude',
    ...overrides,
  };
}

interface FakeChild extends EventEmitter {
  stdin: { end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function makeChild(
  stdout = 'agent response',
  exitCode = 0,
  stderr = '',
  delay = 1,
): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = { end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  }, delay);

  return child;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- spawn() -----------------------------------------------------------

  describe('spawn()', () => {
    describe('claude backend', () => {
      it('calls spawn with "claude" as the command', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        expect(spawnMock).toHaveBeenCalledWith('claude', expect.any(Array), expect.any(Object));
      });

      it('passes --session-id arg', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--session-id');
        expect(args[args.indexOf('--session-id') + 1]).toBe('test-uuid-1234');
      });

      it('passes --add-dir repoPath arg', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/my/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--add-dir');
        expect(args[args.indexOf('--add-dir') + 1]).toBe('/my/repo');
      });

      it('passes --max-turns 3', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--max-turns');
        expect(args[args.indexOf('--max-turns') + 1]).toBe('3');
      });

      it('includes --model arg when model is set', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent({ model: 'opus' }), 'system', 'hello', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--model');
        expect(args[args.indexOf('--model') + 1]).toBe('opus');
      });

      it('omits --model arg when model is undefined', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).not.toContain('--model');
      });

      it('includes read-only tool restrictions', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--tools');
        expect(args).toContain('--allowedTools');
      });

      it('includes --disable-slash-commands', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--disable-slash-commands');
      });

      it('includes --disallowedTools Task', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--disallowedTools');
        expect(args[args.indexOf('--disallowedTools') + 1]).toBe('Task');
      });

      it('concatenates system prompt and initial prompt with separator', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'You are a reviewer', 'Review auth', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        const pIdx = args.indexOf('-p');
        expect(args[pIdx + 1]).toBe('You are a reviewer\n\n---\n\nReview auth');
      });

      it('closes stdin immediately', async () => {
        const child = makeChild('output');
        spawnMock.mockReturnValue(child);
        await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        expect(child.stdin.end).toHaveBeenCalled();
      });

      it('returns { output, sessionId } on success', async () => {
        spawnMock.mockReturnValue(makeChild('the response'));
        const result = await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        expect(result.output).toBe('the response');
        expect(result.sessionId).toBe('test-uuid-1234');
      });

      it('stores session info after successful spawn', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent({ name: 'alpha' }), 'system', 'hello', '/repo');
        expect(sm.hasSession('alpha')).toBe(true);
        const info = sm.getSession('alpha');
        expect(info?.backend).toBe('claude');
        expect(info?.sessionId).toBe('test-uuid-1234');
        expect(info?.history).toEqual(['hello', 'output']);
      });

      it('does NOT store session info on spawn failure', async () => {
        const child = new EventEmitter() as FakeChild;
        child.stdin = { end: vi.fn() };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        setTimeout(() => {
          child.emit('close', 1);
        }, 1);
        spawnMock.mockReturnValue(child);

        await expect(sm.spawn(makeAgent({ name: 'beta' }), 'system', 'hello', '/repo'))
          .rejects.toThrow();
        expect(sm.hasSession('beta')).toBe(false);
      });

      it('rejects when spawn emits error (binary not found)', async () => {
        const child = new EventEmitter() as FakeChild;
        child.stdin = { end: vi.fn() };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        setTimeout(() => {
          child.emit('error', new Error('ENOENT'));
        }, 1);
        spawnMock.mockReturnValue(child);

        await expect(sm.spawn(makeAgent(), 'system', 'hello', '/repo'))
          .rejects.toThrow('Failed to spawn claude: ENOENT');
      });

      it('resolves with stdout on non-zero exit if stdout is present', async () => {
        spawnMock.mockReturnValue(makeChild('some output', 1));
        const result = await sm.spawn(makeAgent(), 'system', 'hello', '/repo');
        expect(result.output).toBe('some output');
      });

      it('rejects with stderr message on non-zero exit with no stdout', async () => {
        spawnMock.mockReturnValue(makeChild('', 1, 'permission denied'));
        await expect(sm.spawn(makeAgent(), 'system', 'hello', '/repo'))
          .rejects.toThrow('permission denied');
      });

      it('rejects with exit code message when both stdout and stderr are empty', async () => {
        spawnMock.mockReturnValue(makeChild('', 1, ''));
        await expect(sm.spawn(makeAgent(), 'system', 'hello', '/repo'))
          .rejects.toThrow('claude exited with code 1');
      });

      it('sets cwd to repoPath', async () => {
        spawnMock.mockReturnValue(makeChild('output'));
        await sm.spawn(makeAgent(), 'system', 'hello', '/my/repo');
        const opts = spawnMock.mock.calls[0][2];
        expect(opts.cwd).toBe('/my/repo');
      });
    });

    describe('non-claude backend', () => {
      it('rejects with unsupported backend message', async () => {
        await expect(sm.spawn(makeAgent({ backend: 'gemini' }), 'system', 'hello', '/repo'))
          .rejects.toThrow('Backend "gemini" is not yet supported in agentic mode');
      });

      it('does not store session info on rejection', async () => {
        await expect(sm.spawn(makeAgent({ name: 'x', backend: 'ollama' }), 'sys', 'hi', '/repo'))
          .rejects.toThrow();
        expect(sm.hasSession('x')).toBe(false);
      });
    });
  });

  // ---- resume() ----------------------------------------------------------

  describe('resume()', () => {
    it('throws "No session for agent" when agent never spawned', async () => {
      await expect(sm.resume('unknown', 'hi', '/repo'))
        .rejects.toThrow('No session for agent: unknown');
    });

    describe('claude backend', () => {
      beforeEach(async () => {
        spawnMock.mockReturnValue(makeChild('initial output'));
        await sm.spawn(makeAgent({ name: 'reviewer' }), 'system', 'hello', '/repo');
        spawnMock.mockReset();
      });

      it('calls spawn with "-r <sessionId>" (resume flag)', async () => {
        spawnMock.mockReturnValue(makeChild('resumed output'));
        await sm.resume('reviewer', 'new message', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('-r');
        expect(args[args.indexOf('-r') + 1]).toBe('test-uuid-1234');
      });

      it('passes message as the -p arg', async () => {
        spawnMock.mockReturnValue(makeChild('resumed'));
        await sm.resume('reviewer', 'check this', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        const pIdx = args.indexOf('-p');
        expect(args[pIdx + 1]).toBe('check this');
      });

      it('passes --max-turns 3 on resume', async () => {
        spawnMock.mockReturnValue(makeChild('resumed'));
        await sm.resume('reviewer', 'msg', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--max-turns');
        expect(args[args.indexOf('--max-turns') + 1]).toBe('3');
      });

      it('does NOT pass --add-dir in resume args', async () => {
        spawnMock.mockReturnValue(makeChild('resumed'));
        await sm.resume('reviewer', 'msg', '/repo');
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).not.toContain('--add-dir');
      });

      it('returns output string', async () => {
        spawnMock.mockReturnValue(makeChild('the response'));
        const output = await sm.resume('reviewer', 'msg', '/repo');
        expect(output).toBe('the response');
      });

      it('appends message and output to session history on success', async () => {
        spawnMock.mockReturnValue(makeChild('response 2'));
        await sm.resume('reviewer', 'message 2', '/repo');
        const info = sm.getSession('reviewer');
        expect(info?.history).toEqual(['hello', 'initial output', 'message 2', 'response 2']);
      });

      it('does NOT mutate history on failure', async () => {
        const child = new EventEmitter() as FakeChild;
        child.stdin = { end: vi.fn() };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        setTimeout(() => child.emit('close', 1), 1);
        spawnMock.mockReturnValue(child);

        await expect(sm.resume('reviewer', 'will fail', '/repo')).rejects.toThrow();
        const info = sm.getSession('reviewer');
        expect(info?.history).toEqual(['hello', 'initial output']);
      });
    });
  });

  // ---- hasSession / getSession / clear -----------------------------------

  describe('hasSession()', () => {
    it('returns false before spawn', () => {
      expect(sm.hasSession('nope')).toBe(false);
    });

    it('returns true after successful spawn', async () => {
      spawnMock.mockReturnValue(makeChild('output'));
      await sm.spawn(makeAgent({ name: 'a' }), 'sys', 'hi', '/repo');
      expect(sm.hasSession('a')).toBe(true);
    });

    it('returns false after clear()', async () => {
      spawnMock.mockReturnValue(makeChild('output'));
      await sm.spawn(makeAgent({ name: 'a' }), 'sys', 'hi', '/repo');
      sm.clear();
      expect(sm.hasSession('a')).toBe(false);
    });
  });

  describe('getSession()', () => {
    it('returns undefined for unknown agent', () => {
      expect(sm.getSession('nope')).toBeUndefined();
    });

    it('returns SessionInfo with correct fields after spawn', async () => {
      spawnMock.mockReturnValue(makeChild('output'));
      await sm.spawn(makeAgent({ name: 'test-agent' }), 'sys', 'prompt', '/repo');
      const info = sm.getSession('test-agent');
      expect(info).toMatchObject({
        agentName: 'test-agent',
        backend: 'claude',
        sessionId: 'test-uuid-1234',
      });
      expect(info?.history).toEqual(['prompt', 'output']);
    });
  });

  describe('clear()', () => {
    it('removes all sessions', async () => {
      spawnMock.mockReturnValue(makeChild('out'));
      await sm.spawn(makeAgent({ name: 'a' }), 'sys', 'hi', '/r');
      spawnMock.mockReturnValue(makeChild('out'));
      await sm.spawn(makeAgent({ name: 'b' }), 'sys', 'hi', '/r');
      sm.clear();
      expect(sm.hasSession('a')).toBe(false);
      expect(sm.hasSession('b')).toBe(false);
    });
  });

  // ---- cleanEnv ----------------------------------------------------------

  describe('cleanEnv()', () => {
    it('strips CLAUDECODE from environment', async () => {
      process.env.CLAUDECODE = 'true';
      spawnMock.mockReturnValue(makeChild('output'));
      await sm.spawn(makeAgent(), 'sys', 'hi', '/repo');
      const env = spawnMock.mock.calls[0][2].env;
      expect(env.CLAUDECODE).toBeUndefined();
      delete process.env.CLAUDECODE;
    });

    it('strips CLAUDE_CODE_SESSION from environment', async () => {
      process.env.CLAUDE_CODE_SESSION = 'some-session';
      spawnMock.mockReturnValue(makeChild('output'));
      await sm.spawn(makeAgent(), 'sys', 'hi', '/repo');
      const env = spawnMock.mock.calls[0][2].env;
      expect(env.CLAUDE_CODE_SESSION).toBeUndefined();
      delete process.env.CLAUDE_CODE_SESSION;
    });

    it('preserves other env vars', async () => {
      spawnMock.mockReturnValue(makeChild('output'));
      await sm.spawn(makeAgent(), 'sys', 'hi', '/repo');
      const env = spawnMock.mock.calls[0][2].env;
      expect(env.PATH).toBeDefined();
    });
  });

  // ---- Timeout handling --------------------------------------------------

  describe('timeout handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('kills child process after 600s timeout', async () => {
      const child = new EventEmitter() as FakeChild;
      child.stdin = { end: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      spawnMock.mockReturnValue(child);

      const promise = sm.spawn(makeAgent(), 'sys', 'hi', '/repo');

      // Attach rejection handler BEFORE advancing timers to prevent unhandled rejection
      const rejectCheck = expect(promise).rejects.toThrow('timed out after 600s');

      // Advance past timeout — settle() rejects with timeout message
      await vi.advanceTimersByTimeAsync(600_001);

      await rejectCheck;
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('does not double-reject (settle guard works)', async () => {
      const child = new EventEmitter() as FakeChild;
      child.stdin = { end: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      spawnMock.mockReturnValue(child);

      const promise = sm.spawn(makeAgent(), 'sys', 'hi', '/repo');

      // Emit both error and close synchronously — settle guard prevents double-reject
      child.emit('error', new Error('spawn failed'));
      child.emit('close', 1);

      // Should reject with the first error, not crash with unhandled rejection
      await expect(promise).rejects.toThrow('Failed to spawn claude: spawn failed');

      // Advance past the 600s timeout timer to clean it up (prevent unhandled rejection)
      await vi.advanceTimersByTimeAsync(600_001);
    });
  });
});

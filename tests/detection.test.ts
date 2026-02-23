import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We'll test the detection module by injecting mock functions
// rather than mocking entire modules, since detection.ts will accept
// optional function parameters for testability.

describe('detection', () => {
  let detection: typeof import('../src/detection.js');

  beforeEach(async () => {
    detection = await import('../src/detection.js');
  });

  describe('detectCliBackends', () => {
    it('marks codex and gemini as available when found in PATH', async () => {
      const whichFn = vi.fn(() => true);
      const results = await detection.detectCliBackends(whichFn);

      expect(results).toHaveLength(2);
      const codex = results.find(b => b.name === 'codex');
      const gemini = results.find(b => b.name === 'gemini');

      expect(codex).toBeDefined();
      expect(codex!.available).toBe(true);
      expect(codex!.category).toBe('cli');

      expect(gemini).toBeDefined();
      expect(gemini!.available).toBe(true);
      expect(gemini!.category).toBe('cli');
    });

    it('marks missing binaries as unavailable with install hints', async () => {
      const whichFn = vi.fn(() => false);
      const results = await detection.detectCliBackends(whichFn);

      const codex = results.find(b => b.name === 'codex');
      expect(codex!.available).toBe(false);
      expect(codex!.installHint).toContain('npm install');

      const gemini = results.find(b => b.name === 'gemini');
      expect(gemini!.available).toBe(false);
      expect(gemini!.installHint).toContain('npm install');
    });

    it('includes detail string showing binary location when available', async () => {
      const whichFn = vi.fn(() => true);
      const results = await detection.detectCliBackends(whichFn);
      const codex = results.find(b => b.name === 'codex');
      expect(codex!.detail).toBeTruthy();
    });
  });

  describe('detectLocalBackends', () => {
    it('detects Ollama as available when server responds with models', async () => {
      const whichFn = vi.fn(() => true);
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          models: [
            { name: 'qwen3:latest' },
            { name: 'llama3.2:latest' },
          ],
        }),
      });

      const results = await detection.detectLocalBackends(whichFn, fetchFn);
      const ollama = results.find(b => b.name === 'ollama');

      expect(ollama).toBeDefined();
      expect(ollama!.available).toBe(true);
      expect(ollama!.category).toBe('local');
      expect(ollama!.models).toEqual(['qwen3:latest', 'llama3.2:latest']);
    });

    it('marks Ollama unavailable when server not running but binary installed', async () => {
      const whichFn = vi.fn(() => true);
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const results = await detection.detectLocalBackends(whichFn, fetchFn);
      const ollama = results.find(b => b.name === 'ollama');

      expect(ollama!.available).toBe(false);
      expect(ollama!.detail).toContain('not running');
      expect(ollama!.installHint).toContain('ollama serve');
    });

    it('marks Ollama unavailable when not installed at all', async () => {
      const whichFn = vi.fn(() => false);
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const results = await detection.detectLocalBackends(whichFn, fetchFn);
      const ollama = results.find(b => b.name === 'ollama');

      expect(ollama!.available).toBe(false);
      expect(ollama!.detail).toContain('not installed');
      expect(ollama!.installHint).toContain('ollama');
    });

    it('passes abort signal as { signal } init object to fetch', async () => {
      const whichFn = vi.fn(() => true);
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      await detection.detectLocalBackends(whichFn, fetchFn);

      expect(fetchFn).toHaveBeenCalledOnce();
      const [, init] = fetchFn.mock.calls[0];
      expect(init).toHaveProperty('signal');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('marks Ollama available when server responds with models even without local binary', async () => {
      const whichFn = vi.fn(() => false);
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          models: [{ name: 'qwen3:latest' }],
        }),
      });

      const results = await detection.detectLocalBackends(whichFn, fetchFn);
      const ollama = results.find(b => b.name === 'ollama');

      expect(ollama!.available).toBe(true);
      expect(ollama!.models).toEqual(['qwen3:latest']);
    });

    it('marks Ollama unavailable when running but has no models', async () => {
      const whichFn = vi.fn(() => true);
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      const results = await detection.detectLocalBackends(whichFn, fetchFn);
      const ollama = results.find(b => b.name === 'ollama');

      expect(ollama!.available).toBe(false);
      expect(ollama!.detail).toContain('no models');
      expect(ollama!.installHint).toContain('ollama pull');
    });

    it('returns models as empty array (not undefined) when server reachable but has 0 models', async () => {
      const whichFn = vi.fn(() => true);
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      const results = await detection.detectLocalBackends(whichFn, fetchFn);
      const ollama = results.find(b => b.name === 'ollama');

      expect(ollama!.models).toEqual([]);
      expect(ollama!.models).not.toBeUndefined();
    });

    it('returns models as undefined when server is not reachable', async () => {
      const whichFn = vi.fn(() => false);
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const results = await detection.detectLocalBackends(whichFn, fetchFn);
      const ollama = results.find(b => b.name === 'ollama');

      expect(ollama!.models).toBeUndefined();
    });
  });

  describe('detectHostIntegrations', () => {
    it('detects claude binary in PATH', async () => {
      const whichFn = vi.fn(() => true);
      const results = await detection.detectHostIntegrations(whichFn);
      const claude = results.find(b => b.name === 'claude');

      expect(claude).toBeDefined();
      expect(claude!.available).toBe(true);
      expect(claude!.category).toBe('host' as string);
    });

    it('marks claude as unavailable when not in PATH', async () => {
      const whichFn = vi.fn(() => false);
      const results = await detection.detectHostIntegrations(whichFn);
      const claude = results.find(b => b.name === 'claude');

      expect(claude!.available).toBe(false);
      expect(claude!.installHint).toContain('npm install');
    });
  });

  describe('detectEnvironment', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('detects active tmux session via TMUX env var', () => {
      process.env.TMUX = '/private/tmp/tmux-501/default,12345,0';
      const result = detection.detectEnvironment();
      expect(result.tmux.active).toBe(true);
    });

    it('reports tmux inactive when TMUX env var is unset', () => {
      delete process.env.TMUX;
      const result = detection.detectEnvironment();
      expect(result.tmux.active).toBe(false);
    });

    it('reports tmux inactive when TMUX env var is empty', () => {
      process.env.TMUX = '';
      const result = detection.detectEnvironment();
      expect(result.tmux.active).toBe(false);
    });

    it('detects tmux installed via whichFn', () => {
      const whichFn = vi.fn((name: string) => name === 'tmux');
      const result = detection.detectEnvironment(whichFn);
      expect(result.tmux.installed).toBe(true);
    });

    it('reports tmux not installed when not in PATH', () => {
      const whichFn = vi.fn(() => false);
      const result = detection.detectEnvironment(whichFn);
      expect(result.tmux.installed).toBe(false);
    });

    it('detects agent teams enabled via env var', () => {
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
      const result = detection.detectEnvironment();
      expect(result.agentTeams.enabled).toBe(true);
    });

    it('reports agent teams not enabled when env var is unset', () => {
      delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      const result = detection.detectEnvironment();
      expect(result.agentTeams.enabled).toBe(false);
    });

    it('reports agent teams not enabled when env var is not "1"', () => {
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '0';
      const result = detection.detectEnvironment();
      expect(result.agentTeams.enabled).toBe(false);
    });
  });

  describe('detectAll', () => {
    it('returns a complete DetectionReport with all categories', async () => {
      const whichFn = vi.fn((name: string) => name === 'codex');
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const report = await detection.detectAll(whichFn, fetchFn);

      expect(report.cli).toBeDefined();
      expect(report.local).toBeDefined();
      expect(report.host).toBeDefined();
      expect(report.environment).toBeDefined();

      expect(report.cli.length).toBeGreaterThan(0);
      expect(report.local.length).toBeGreaterThan(0);
      expect(report.host.length).toBeGreaterThan(0);
    });

    it('correctly reports available relay backend count', async () => {
      const whichFn = vi.fn((name: string) => name === 'codex' || name === 'gemini');
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const report = await detection.detectAll(whichFn, fetchFn);

      const allRelay = [...report.cli, ...report.local];
      const available = allRelay.filter(b => b.available);
      expect(available.length).toBe(2); // codex + gemini
    });

    it('includes environment detection in report', async () => {
      const whichFn = vi.fn((name: string) => name === 'tmux');
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const report = await detection.detectAll(whichFn, fetchFn);

      expect(report.environment).toBeDefined();
      expect(report.environment.tmux).toBeDefined();
      expect(report.environment.agentTeams).toBeDefined();
      expect(report.environment.tmux.installed).toBe(true);
    });
  });
});

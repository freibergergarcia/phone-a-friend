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
  });

  describe('detectApiBackends', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('marks openai as available when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test-123';
      const results = detection.detectApiBackends();
      const openai = results.find(b => b.name === 'openai');

      expect(openai!.available).toBe(true);
      expect(openai!.category).toBe('api');
      expect(openai!.detail).toContain('set');
    });

    it('marks openai as unavailable when env var not set', () => {
      delete process.env.OPENAI_API_KEY;
      const results = detection.detectApiBackends();
      const openai = results.find(b => b.name === 'openai');

      expect(openai!.available).toBe(false);
      expect(openai!.installHint).toContain('OPENAI_API_KEY');
    });

    it('marks anthropic and google as planned', () => {
      const results = detection.detectApiBackends();
      const anthropic = results.find(b => b.name === 'anthropic');
      const google = results.find(b => b.name === 'google');

      expect(anthropic!.planned).toBe(true);
      expect(google!.planned).toBe(true);
    });

    it('returns all three API backends', () => {
      const results = detection.detectApiBackends();
      const names = results.map(b => b.name);
      expect(names).toContain('openai');
      expect(names).toContain('anthropic');
      expect(names).toContain('google');
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

  describe('detectAll', () => {
    it('returns a complete DetectionReport with all four categories', async () => {
      const whichFn = vi.fn((name: string) => name === 'codex');
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const report = await detection.detectAll(whichFn, fetchFn);

      expect(report.cli).toBeDefined();
      expect(report.local).toBeDefined();
      expect(report.api).toBeDefined();
      expect(report.host).toBeDefined();

      expect(report.cli.length).toBeGreaterThan(0);
      expect(report.local.length).toBeGreaterThan(0);
      expect(report.api.length).toBeGreaterThan(0);
      expect(report.host.length).toBeGreaterThan(0);
    });

    it('correctly reports available relay backend count', async () => {
      const whichFn = vi.fn((name: string) => name === 'codex' || name === 'gemini');
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const report = await detection.detectAll(whichFn, fetchFn);

      const allRelay = [...report.cli, ...report.local, ...report.api];
      const available = allRelay.filter(b => b.available);
      expect(available.length).toBe(2); // codex + gemini
    });
  });
});

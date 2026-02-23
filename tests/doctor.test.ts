import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectionReport } from '../src/detection.js';

// Mock detection and config modules
const { mockDetectAll, mockLoadConfig, mockConfigPaths } = vi.hoisted(() => ({
  mockDetectAll: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockConfigPaths: vi.fn(),
}));

vi.mock('../src/detection.js', () => ({
  detectAll: mockDetectAll,
}));

vi.mock('../src/config.js', () => ({
  loadConfig: mockLoadConfig,
  configPaths: mockConfigPaths,
  DEFAULT_CONFIG: {
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
  },
}));

// Helper: build a detection report
function makeReport(overrides?: Partial<DetectionReport>): DetectionReport {
  return {
    cli: [
      { name: 'codex', category: 'cli', available: true, detail: 'OpenAI Codex CLI (found in PATH)', installHint: 'npm install -g @openai/codex' },
      { name: 'gemini', category: 'cli', available: false, detail: 'not found in PATH', installHint: 'npm install -g @google/gemini-cli' },
    ],
    local: [
      { name: 'ollama', category: 'local', available: true, detail: 'http://localhost:11434 (2 models)', installHint: '', models: ['qwen3:latest', 'llama3.2:latest'] },
    ],
    host: [
      { name: 'claude', category: 'host' as 'cli', available: true, detail: 'Claude Code CLI (found in PATH)', installHint: 'npm install -g @anthropic-ai/claude-code' },
    ],
    ...overrides,
  };
}

describe('doctor', () => {
  let doctor: typeof import('../src/doctor.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConfigPaths.mockReturnValue({
      user: '/home/test/.config/phone-a-friend/config.toml',
      repo: null,
    });
    mockLoadConfig.mockReturnValue({
      defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    });
    doctor = await import('../src/doctor.js');
  });

  describe('human-readable output', () => {
    it('returns health check output with system info', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('Health Check');
      expect(result.output).toContain('Node.js');
    });

    it('shows CLI backends with availability marks', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      // Available backend gets checkmark
      expect(result.output).toMatch(/codex/);
      // Unavailable backend gets X
      expect(result.output).toMatch(/gemini/);
    });

    it('shows local backends (Ollama)', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('ollama');
      expect(result.output).toContain('2 models');
    });

    it('shows host integrations separately', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('Host');
      expect(result.output).toContain('claude');
    });

    it('shows install hints for missing backends', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('npm install -g @google/gemini-cli');
    });

    it('shows default backend from config', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('Default');
      expect(result.output).toContain('codex');
    });

    it('shows relay backend summary count', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      // codex + ollama = 2 available out of 3 total relay backends
      expect(result.output).toContain('2');
    });
  });

  describe('exit codes', () => {
    it('returns 0 when all relay backends are healthy', async () => {
      const report = makeReport({
        cli: [
          { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'gemini', category: 'cli', available: true, detail: 'found', installHint: '' },
        ],
        local: [
          { name: 'ollama', category: 'local', available: true, detail: 'running', installHint: '' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();
      expect(result.exitCode).toBe(0);
    });

    it('returns 1 when some implemented backends have issues', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();
      // gemini unavailable -> exit 1
      expect(result.exitCode).toBe(1);
    });

    it('returns 2 when no relay backends are available', async () => {
      const report = makeReport({
        cli: [
          { name: 'codex', category: 'cli', available: false, detail: 'not found', installHint: 'install codex' },
          { name: 'gemini', category: 'cli', available: false, detail: 'not found', installHint: 'install gemini' },
        ],
        local: [
          { name: 'ollama', category: 'local', available: false, detail: 'not installed', installHint: 'install ollama' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();
      expect(result.exitCode).toBe(2);
    });
  });

  describe('JSON output', () => {
    it('returns structured JSON when json flag is set', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor({ json: true });

      const parsed = JSON.parse(result.output);
      expect(parsed.system).toBeDefined();
      expect(parsed.backends).toBeDefined();
      expect(parsed.backends.cli).toBeDefined();
      expect(parsed.backends.local).toBeDefined();
      expect(parsed.host).toBeDefined();
      expect(parsed.default).toBe('codex');
      expect(parsed.exitCode).toBeDefined();
    });

    it('JSON includes relay backend count', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor({ json: true });
      const parsed = JSON.parse(result.output);

      expect(parsed.summary.available).toBe(2);
      expect(parsed.summary.total).toBe(3);
    });
  });
});

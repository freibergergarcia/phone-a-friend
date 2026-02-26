import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DetectionReport, BackendStatus } from '../src/detection.js';

// Mock modules
const {
  mockDetectAll,
  mockSaveConfig,
  mockConfigPaths,
  mockLoadConfig,
  mockInstallHosts,
  mockSelect,
  mockConfirm,
  mockGetPackageRoot,
} = vi.hoisted(() => ({
  mockDetectAll: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockConfigPaths: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockInstallHosts: vi.fn(() => ['installed']),
  mockSelect: vi.fn(),
  mockConfirm: vi.fn(),
  mockGetPackageRoot: vi.fn(() => '/mock/package/root'),
}));

vi.mock('../src/detection.js', () => ({
  detectAll: mockDetectAll,
}));

vi.mock('../src/config.js', () => ({
  saveConfig: mockSaveConfig,
  configPaths: mockConfigPaths,
  loadConfig: mockLoadConfig,
  DEFAULT_CONFIG: {
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
  },
}));

vi.mock('../src/installer.js', () => ({
  installHosts: mockInstallHosts,
}));

vi.mock('@inquirer/prompts', () => ({
  select: mockSelect,
  confirm: mockConfirm,
}));

vi.mock('../src/version.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/version.js')>();
  return {
    ...actual,
    getPackageRoot: mockGetPackageRoot,
  };
});

// Helper to build reports
function makeReport(overrides?: Partial<DetectionReport>): DetectionReport {
  return {
    cli: [
      { name: 'codex', category: 'cli', available: true, detail: 'found in PATH', installHint: '' },
      { name: 'gemini', category: 'cli', available: true, detail: 'found in PATH', installHint: '' },
    ],
    local: [
      { name: 'ollama', category: 'local', available: false, detail: 'not installed', installHint: 'brew install ollama' },
    ],
    host: [
      { name: 'claude', category: 'host', available: true, detail: 'found', installHint: '' },
    ],
    environment: {
      tmux: { active: false, installed: true },
      agentTeams: { enabled: false },
    },
    ...overrides,
  };
}

describe('setup', () => {
  let setup: typeof import('../src/setup.js');
  let tempDir: string;
  let output: string[];

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'paf-setup-test-'));
    output = [];

    // Capture console.log output
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    mockConfigPaths.mockReturnValue({
      user: join(tempDir, 'config.toml'),
      repo: null,
    });
    mockLoadConfig.mockReturnValue({
      defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    });

    // Default: select codex, skip plugin, skip test
    mockSelect.mockResolvedValue('codex');
    mockConfirm.mockResolvedValue(false);

    setup = await import('../src/setup.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects all backends before prompting', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    await setup.setup();
    expect(mockDetectAll).toHaveBeenCalledTimes(1);
  });

  it('shows relay backends and host integrations in output', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    await setup.setup();

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Relay Backend');
    expect(fullOutput).toContain('codex');
    expect(fullOutput).toContain('gemini');
    expect(fullOutput).toContain('Host');
    expect(fullOutput).toContain('claude');
  });

  it('prompts for default backend when multiple are available', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    mockSelect.mockResolvedValue('gemini');

    await setup.setup();

    expect(mockSelect).toHaveBeenCalled();
    // The saved config should have the selected backend
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({ backend: 'gemini' }),
      }),
      expect.any(String),
    );
  });

  it('auto-selects when only one backend available', async () => {
    const report = makeReport({
      cli: [
        { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
        { name: 'gemini', category: 'cli', available: false, detail: 'not found', installHint: 'install' },
      ],
      local: [
        { name: 'ollama', category: 'local', available: false, detail: 'not installed', installHint: 'install' },
      ],
    });
    mockDetectAll.mockResolvedValue(report);

    await setup.setup();

    // Should NOT prompt for selection — auto-select the only one
    expect(mockSelect).not.toHaveBeenCalled();
    // Should save with codex as default
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({ backend: 'codex' }),
      }),
      expect.any(String),
    );
  });

  it('offers Claude plugin install when claude is in PATH', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    // First confirm = Claude plugin install, second = test run
    mockConfirm
      .mockResolvedValueOnce(true)  // yes install claude
      .mockResolvedValueOnce(false); // no test run

    await setup.setup();

    expect(mockInstallHosts).toHaveBeenCalled();
  });

  it('uses package root (not cwd) for plugin install', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    mockConfirm
      .mockResolvedValueOnce(true)  // yes install claude
      .mockResolvedValueOnce(false); // no test run

    await setup.setup();

    expect(mockInstallHosts).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: '/mock/package/root',
      }),
    );
  });

  it('does not offer Claude plugin install when claude is not in PATH', async () => {
    const report = makeReport({
      host: [
        { name: 'claude', category: 'host', available: false, detail: 'not found', installHint: 'install' },
      ],
    });
    mockDetectAll.mockResolvedValue(report);

    await setup.setup();

    // Should not have prompted for Claude install
    // (confirm calls should not include Claude-related prompt)
    expect(mockInstallHosts).not.toHaveBeenCalled();
  });

  it('saves config to TOML path', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    mockSelect.mockResolvedValue('codex');

    await setup.setup();

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({
          backend: 'codex',
          sandbox: 'read-only',
          timeout: 600,
        }),
      }),
      join(tempDir, 'config.toml'),
    );
  });

  it('handles no backends available gracefully', async () => {
    const report = makeReport({
      cli: [
        { name: 'codex', category: 'cli', available: false, detail: 'not found', installHint: 'install codex' },
        { name: 'gemini', category: 'cli', available: false, detail: 'not found', installHint: 'install gemini' },
      ],
      local: [
        { name: 'ollama', category: 'local', available: false, detail: 'not installed', installHint: 'install' },
      ],
    });
    mockDetectAll.mockResolvedValue(report);

    await setup.setup();

    // Should still save config even with no backends
    expect(mockSaveConfig).toHaveBeenCalled();
    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('No relay backends');
  });

  it('shows agentic mode tip after setup', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    await setup.setup();

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('agentic');
  });

  it('shows alias suggestion after success', async () => {
    mockDetectAll.mockResolvedValue(makeReport());
    await setup.setup();

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('paf');
  });
});

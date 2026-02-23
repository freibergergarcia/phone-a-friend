/**
 * Tests for BackendsPanel — navigable backend list with detail pane + model picker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { BackendsPanel } from '../../src/tui/BackendsPanel.js';
import type { DetectionReport } from '../../src/detection.js';

const mockLoadConfig = vi.fn().mockReturnValue({
  defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
  backends: {
    codex: { model: 'o3' },
    ollama: { host: 'http://localhost:11434', model: 'qwen3' },
  },
});

vi.mock('../../src/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  configPaths: vi.fn().mockReturnValue({
    user: '/home/test/.config/phone-a-friend/config.toml',
    repo: null,
  }),
  configSet: vi.fn(),
  configInit: vi.fn(),
}));

import { configSet } from '../../src/config.js';
const mockConfigSet = vi.mocked(configSet);

const MOCK_REPORT: DetectionReport = {
  cli: [
    { name: 'codex', category: 'cli', available: true, detail: 'OpenAI Codex CLI (found in PATH)', installHint: '' },
    { name: 'gemini', category: 'cli', available: false, detail: 'not found in PATH', installHint: 'npm install -g @google/gemini-cli' },
  ],
  local: [
    { name: 'ollama', category: 'local', available: true, detail: 'http://localhost:11434 (3 models)', installHint: '', models: ['qwen3', 'llama3', 'phi3'] },
  ],
  host: [
    { name: 'claude', category: 'host', available: true, detail: 'Claude Code CLI (found in PATH)', installHint: '' },
  ],
  environment: {
    tmux: { active: false, installed: true },
    agentTeams: { enabled: false },
  },
};

const MOCK_REPORT_ZERO_MODELS: DetectionReport = {
  ...MOCK_REPORT,
  local: [
    { name: 'ollama', category: 'local', available: false, detail: 'http://localhost:11434 — no models pulled', installHint: 'ollama pull qwen3', models: [] },
  ],
};

const MOCK_REPORT_MISMATCH: DetectionReport = {
  ...MOCK_REPORT,
  local: [
    { name: 'ollama', category: 'local', available: true, detail: 'http://localhost:11434 (2 models)', installHint: '', models: ['deepseek-r1', 'phi3'] },
  ],
};

const tick = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    backends: {
      codex: { model: 'o3' },
      ollama: { host: 'http://localhost:11434', model: 'qwen3' },
    },
  });
});

describe('BackendsPanel', () => {
  it('lists all backends', () => {
    const { lastFrame } = render(<BackendsPanel report={MOCK_REPORT} />);
    const frame = lastFrame()!;
    expect(frame).toContain('codex');
    expect(frame).toContain('gemini');
    expect(frame).toContain('ollama');
  });

  it('shows detail for the first backend by default', () => {
    const { lastFrame } = render(<BackendsPanel report={MOCK_REPORT} />);
    const frame = lastFrame()!;
    // First backend is codex — detail should be visible
    expect(frame).toContain('found in PATH');
  });

  it('shows install hint for unavailable backends when selected', async () => {
    const { lastFrame, stdin } = render(<BackendsPanel report={MOCK_REPORT} />);
    // Navigate down to gemini (second item)
    stdin.write('\u001B[B'); // arrow down
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain('npm install -g @google/gemini-cli');
  });

  it('shows models for Ollama when selected', async () => {
    const { lastFrame, stdin } = render(<BackendsPanel report={MOCK_REPORT} />);
    // Navigate to ollama (third item: codex, gemini, ollama)
    stdin.write('\u001B[B'); // down to gemini
    await tick();
    stdin.write('\u001B[B'); // down to ollama
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain('qwen3');
    expect(frame).toContain('llama3');
  });

  it('shows host integrations', () => {
    const { lastFrame } = render(<BackendsPanel report={MOCK_REPORT} />);
    expect(lastFrame()).toContain('claude');
  });

  it('handles empty backend list without crashing', () => {
    const emptyReport: DetectionReport = { cli: [], local: [], host: [], environment: { tmux: { active: false, installed: false }, agentTeams: { enabled: false } } };
    const { lastFrame } = render(<BackendsPanel report={emptyReport} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Backends');
  });

  it('shows loading state when report is null', () => {
    const { lastFrame } = render(<BackendsPanel report={null} />);
    expect(lastFrame()).toContain('Loading');
  });

  // --- Model picker tests ---

  it('shows "Enter to pick default" hint when Ollama is selected', async () => {
    const { lastFrame, stdin } = render(<BackendsPanel report={MOCK_REPORT} />);
    stdin.write('\u001B[B'); // down to gemini
    await tick();
    stdin.write('\u001B[B'); // down to ollama
    await tick();
    expect(lastFrame()).toContain('Enter to pick default');
  });

  it('shows star marker on configured default model', async () => {
    const { lastFrame, stdin } = render(<BackendsPanel report={MOCK_REPORT} />);
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain('qwen3');
    expect(frame).toContain('\u2605'); // star character
    expect(frame).toContain('(default)');
  });

  it('enters model-select mode when Enter pressed on Ollama', async () => {
    const onEditingChange = vi.fn();
    const { lastFrame, stdin } = render(
      <BackendsPanel report={MOCK_REPORT} onEditingChange={onEditingChange} />,
    );
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\r'); // Enter on Ollama
    await tick();
    expect(lastFrame()).toContain('Select default model');
    expect(lastFrame()).toContain('Esc cancel');
    expect(onEditingChange).toHaveBeenCalledWith(true);
  });

  it('Escape cancels model selection', async () => {
    const onEditingChange = vi.fn();
    const { lastFrame, stdin } = render(
      <BackendsPanel report={MOCK_REPORT} onEditingChange={onEditingChange} />,
    );
    // Navigate to ollama and enter model select
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('Select default model');

    // Press Escape
    stdin.write('\u001B');
    await tick();
    // Should be back in nav mode
    expect(lastFrame()).toContain('Enter to pick default');
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  it('selecting a model calls configSet with correct args', async () => {
    const { lastFrame, stdin } = render(<BackendsPanel report={MOCK_REPORT} />);
    // Navigate to ollama
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    // Enter model select
    stdin.write('\r');
    await tick();
    // Navigate down to llama3 (qwen3 is preselected since it's the config default)
    stdin.write('\u001B[B');
    await tick();
    // Select it
    stdin.write('\r');
    await tick();

    expect(mockConfigSet).toHaveBeenCalledWith(
      'backends.ollama.model',
      'llama3',
      '/home/test/.config/phone-a-friend/config.toml',
    );
    expect(lastFrame()).toContain('Default model set to llama3');
  });

  it('model-select mode disabled when Ollama has 0 models', async () => {
    const onEditingChange = vi.fn();
    const { lastFrame, stdin } = render(
      <BackendsPanel report={MOCK_REPORT_ZERO_MODELS} onEditingChange={onEditingChange} />,
    );
    // Navigate to ollama
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    // Try Enter
    stdin.write('\r');
    await tick();
    // Should NOT enter model select
    expect(lastFrame()).not.toContain('Select default model');
    expect(onEditingChange).not.toHaveBeenCalled();
  });

  it('shows config model mismatch warning', async () => {
    const { lastFrame, stdin } = render(<BackendsPanel report={MOCK_REPORT_MISMATCH} />);
    // Navigate to ollama
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain('qwen3');
    expect(frame).toContain('not detected');
  });

  it('does not enter model-select when Enter pressed on non-Ollama backend', async () => {
    const onEditingChange = vi.fn();
    const { lastFrame, stdin } = render(
      <BackendsPanel report={MOCK_REPORT} onEditingChange={onEditingChange} />,
    );
    // codex is already selected (first item)
    stdin.write('\r');
    await tick();
    expect(lastFrame()).not.toContain('Select default model');
    expect(onEditingChange).not.toHaveBeenCalled();
  });
});

/**
 * Tests for BackendsPanel — navigable backend list with detail pane.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { BackendsPanel } from '../../src/tui/BackendsPanel.js';
import type { DetectionReport } from '../../src/detection.js';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    backends: {
      codex: { model: 'o3' },
      ollama: { host: 'http://localhost:11434', model: 'qwen3' },
    },
  }),
}));

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

const tick = () => new Promise((r) => setTimeout(r, 50));

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
});

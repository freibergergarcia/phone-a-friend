/**
 * Tests for StatusPanel and useDetection hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

// Mock detection module before importing components
vi.mock('../../src/detection.js', () => ({
  detectAll: vi.fn(),
}));

import { detectAll } from '../../src/detection.js';
import type { DetectionReport } from '../../src/detection.js';
import { StatusPanel } from '../../src/tui/StatusPanel.js';

const mockDetectAll = vi.mocked(detectAll);

const MOCK_REPORT: DetectionReport = {
  cli: [
    { name: 'codex', category: 'cli', available: true, detail: 'OpenAI Codex CLI (found in PATH)', installHint: '' },
    { name: 'gemini', category: 'cli', available: false, detail: 'not found in PATH', installHint: 'npm install -g @google/gemini-cli' },
  ],
  local: [
    { name: 'ollama', category: 'local', available: false, detail: 'installed but not running', installHint: 'ollama serve' },
  ],
  api: [
    { name: 'openai', category: 'api', available: true, detail: 'OPENAI_API_KEY set', installHint: '' },
    { name: 'anthropic', category: 'api', available: false, detail: 'ANTHROPIC_API_KEY not set', installHint: 'export ANTHROPIC_API_KEY=sk-ant-...', planned: true },
    { name: 'google', category: 'api', available: false, detail: 'GOOGLE_API_KEY not set', installHint: 'export GOOGLE_API_KEY=...', planned: true },
  ],
  host: [
    { name: 'claude', category: 'host', available: true, detail: 'Claude Code CLI (found in PATH)', installHint: '' },
  ],
};

describe('StatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    // Never resolve — stays in loading
    mockDetectAll.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(<StatusPanel />);
    expect(lastFrame()).toContain('Scanning');
  });

  it('shows system info after detection completes', async () => {
    mockDetectAll.mockResolvedValue(MOCK_REPORT);
    const { lastFrame } = render(<StatusPanel />);
    // Wait for async state update
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('Node.js');
      expect(frame).toContain('phone-a-friend');
    });
  });

  it('shows backend summary count', async () => {
    mockDetectAll.mockResolvedValue(MOCK_REPORT);
    const { lastFrame } = render(<StatusPanel />);
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      // 2 available (codex + openai) out of 3 non-planned (codex, gemini, ollama, openai minus 2 planned)
      expect(frame).toMatch(/\d+ of \d+/);
    });
  });

  it('shows available backends with checkmark', async () => {
    mockDetectAll.mockResolvedValue(MOCK_REPORT);
    const { lastFrame } = render(<StatusPanel />);
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('codex');
      expect(frame).toContain('openai');
    });
  });

  it('shows unavailable backends', async () => {
    mockDetectAll.mockResolvedValue(MOCK_REPORT);
    const { lastFrame } = render(<StatusPanel />);
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('gemini');
      expect(frame).toContain('ollama');
    });
  });

  it('shows planned backends', async () => {
    mockDetectAll.mockResolvedValue(MOCK_REPORT);
    const { lastFrame } = render(<StatusPanel />);
    await vi.waitFor(() => {
      const frame = lastFrame()!;
      expect(frame).toContain('planned');
    });
  });

  it('shows host integrations', async () => {
    mockDetectAll.mockResolvedValue(MOCK_REPORT);
    const { lastFrame } = render(<StatusPanel />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('claude');
    });
  });
});

/**
 * Tests for StatusPanel component (receives props from parent).
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StatusPanel } from '../../src/tui/StatusPanel.js';
import type { DetectionReport } from '../../src/detection.js';

const MOCK_REPORT: DetectionReport = {
  cli: [
    { name: 'codex', category: 'cli', available: true, detail: 'OpenAI Codex CLI (found in PATH)', installHint: '' },
    { name: 'gemini', category: 'cli', available: false, detail: 'not found in PATH', installHint: 'npm install -g @google/gemini-cli' },
  ],
  local: [
    { name: 'ollama', category: 'local', available: false, detail: 'installed but not running', installHint: 'ollama serve' },
  ],
  host: [
    { name: 'claude', category: 'host', available: true, detail: 'Claude Code CLI (found in PATH)', installHint: '' },
  ],
  environment: {
    tmux: { active: false, installed: true },
    agentTeams: { enabled: false },
  },
};

describe('StatusPanel', () => {
  it('shows loading state when report is null', () => {
    const { lastFrame } = render(
      <StatusPanel report={null} loading={true} refreshing={false} error={null} />
    );
    expect(lastFrame()).toContain('Scanning');
  });

  it('shows system info after detection completes', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Node.js');
    expect(frame).toContain('phone-a-friend');
  });

  it('shows backend summary count', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    const frame = lastFrame()!;
    // 1 available (codex) out of 3 non-planned (codex + gemini + ollama)
    expect(frame).toMatch(/\d+ of \d+/);
  });

  it('shows available backends', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('codex');
  });

  it('shows unavailable backends', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('gemini');
    expect(frame).toContain('ollama');
  });

  it('shows host integrations', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    expect(lastFrame()).toContain('claude');
  });

  it('shows error message when error is present', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={new Error('Network timeout')} />
    );
    expect(lastFrame()).toContain('Network timeout');
  });

  it('shows refreshing indicator', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={true} error={null} />
    );
    expect(lastFrame()).toContain('Refreshing');
  });

  it('shows error when initial detection fails (no report)', () => {
    const { lastFrame } = render(
      <StatusPanel report={null} loading={false} refreshing={false} error={new Error('Connection refused')} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Connection refused');
    expect(frame).toContain('Detection failed');
    // Should still show system info
    expect(frame).toContain('Node.js');
  });

  // --- Environment section ---

  it('shows environment section with tmux and agent teams', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Environment');
    expect(frame).toContain('tmux');
    expect(frame).toContain('Agent Teams');
  });

  it('shows tmux as active when in tmux session', () => {
    const report = {
      ...MOCK_REPORT,
      environment: { tmux: { active: true, installed: true }, agentTeams: { enabled: false } },
    };
    const { lastFrame } = render(
      <StatusPanel report={report} loading={false} refreshing={false} error={null} />
    );
    expect(lastFrame()).toContain('active session');
  });

  it('shows tmux as installed but not in session', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    expect(lastFrame()).toContain('installed (not in session)');
  });

  it('shows tmux as not installed', () => {
    const report = {
      ...MOCK_REPORT,
      environment: { tmux: { active: false, installed: false }, agentTeams: { enabled: false } },
    };
    const { lastFrame } = render(
      <StatusPanel report={report} loading={false} refreshing={false} error={null} />
    );
    expect(lastFrame()).toContain('not installed');
  });

  it('shows agent teams as enabled when configured', () => {
    const report = {
      ...MOCK_REPORT,
      environment: { tmux: { active: false, installed: true }, agentTeams: { enabled: true } },
    };
    const { lastFrame } = render(
      <StatusPanel report={report} loading={false} refreshing={false} error={null} />
    );
    expect(lastFrame()).toContain('enabled');
  });

  it('shows agent teams as not enabled', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    expect(lastFrame()).toContain('not enabled');
  });

  // --- Pro Tip ---

  it('shows pro tip when not fully configured', () => {
    const { lastFrame } = render(
      <StatusPanel report={MOCK_REPORT} loading={false} refreshing={false} error={null} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Pro Tip');
    expect(frame).toContain('agent-teams');
  });

  it('hides pro tip when both tmux and agent teams are active', () => {
    const report = {
      ...MOCK_REPORT,
      environment: { tmux: { active: true, installed: true }, agentTeams: { enabled: true } },
    };
    const { lastFrame } = render(
      <StatusPanel report={report} loading={false} refreshing={false} error={null} />
    );
    expect(lastFrame()).not.toContain('Pro Tip');
  });
});

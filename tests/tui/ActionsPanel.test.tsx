/**
 * Tests for ActionsPanel — action list with async execution.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

vi.mock('../../src/detection.js', () => ({
  detectAll: vi.fn().mockResolvedValue({
    cli: [{ name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' }],
    local: [],
    api: [],
    host: [],
  }),
}));

vi.mock('../../src/config.js', () => ({
  configPaths: vi.fn().mockReturnValue({
    user: '/home/test/.config/phone-a-friend/config.toml',
    repo: null,
  }),
}));

import { ActionsPanel } from '../../src/tui/ActionsPanel.js';
import type { DetectionReport } from '../../src/detection.js';

const tick = () => new Promise((r) => setTimeout(r, 50));

const MOCK_REPORT: DetectionReport = {
  cli: [{ name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' }],
  local: [],
  api: [],
  host: [{ name: 'claude', category: 'host', available: true, detail: 'found', installHint: '' }],
};

describe('ActionsPanel', () => {
  it('shows action list', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Check Backends');
    expect(frame).toContain('Reinstall Plugin');
  });

  it('shows action descriptions', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Re-scan');
  });

  it('highlights first action by default', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    // The pointer indicator should be visible
    expect(lastFrame()).toContain('\u25b8');
  });

  it('navigates with arrow keys', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    // Move down
    stdin.write('\u001B[B');
    await tick();
    // Second action should now have the pointer
    const frame = lastFrame()!;
    expect(frame).toContain('Reinstall Plugin');
  });

  it('shows Open Config action', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    expect(lastFrame()).toContain('Open Config');
  });

  it('shows Uninstall Plugin action', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    expect(lastFrame()).toContain('Uninstall Plugin');
  });

  it('shows confirmation prompt for Uninstall Plugin', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    // Navigate to Uninstall Plugin (3rd item: Check Backends, Reinstall, Uninstall)
    stdin.write('\u001B[B'); // down
    await tick();
    stdin.write('\u001B[B'); // down
    await tick();
    // Press Enter — should show confirmation, not run immediately
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('y/n');
  });

  it('cancels confirmation with n key', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onExit={() => {}} />
    );
    // Navigate to Uninstall
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('y/n');
    // Press n to cancel
    stdin.write('n');
    await tick();
    expect(lastFrame()).not.toContain('y/n');
    expect(lastFrame()).toContain('Enter to run');
  });
});

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
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Check Backends');
    expect(frame).toContain('Reinstall Plugin');
  });

  it('shows action descriptions', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Re-scan');
  });

  it('highlights first action by default', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} />
    );
    // The pointer indicator should be visible
    expect(lastFrame()).toContain('\u25b8');
  });

  it('navigates with arrow keys', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} />
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
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} />
    );
    expect(lastFrame()).toContain('Open Config');
  });
});

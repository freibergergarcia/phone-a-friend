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
    host: [],
    environment: { tmux: { active: false, installed: false }, agentTeams: { enabled: false } },
  }),
}));

vi.mock('../../src/config.js', () => ({
  configPaths: vi.fn().mockReturnValue({
    user: '/home/test/.config/phone-a-friend/config.toml',
    repo: null,
  }),
  configInit: vi.fn(),
}));

// Mock child_process.spawn so we can control Uninstall Plugin's subprocess
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { ActionsPanel } from '../../src/tui/ActionsPanel.js';
import type { DetectionReport } from '../../src/detection.js';
import { EventEmitter } from 'node:events';

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

/** Creates a fake ChildProcess that emits 'close' with given code after a tick. */
function makeFakeProc(exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  // Emit close asynchronously so the caller can attach listeners
  setTimeout(() => proc.emit('close', exitCode), 20);
  return proc;
}

const MOCK_REPORT: DetectionReport = {
  cli: [{ name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' }],
  local: [],
  host: [{ name: 'claude', category: 'host', available: true, detail: 'found', installHint: '' }],
  environment: { tmux: { active: false, installed: false }, agentTeams: { enabled: false } },
};

describe('ActionsPanel', () => {
  it('shows action list', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Check Backends');
    expect(frame).toContain('Reinstall Plugin');
  });

  it('shows action descriptions', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Re-scan');
  });

  it('highlights first action by default', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    // The pointer indicator should be visible
    expect(lastFrame()).toContain('\u25b8');
  });

  it('navigates with arrow keys', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
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
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    expect(lastFrame()).toContain('Open Config');
  });

  it('shows Uninstall Plugin action', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    expect(lastFrame()).toContain('Uninstall Plugin');
  });

  it('shows confirmation prompt for Uninstall Plugin', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
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
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
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

  it('confirming y on Uninstall Plugin runs action and calls onExit', async () => {
    const onExit = vi.fn();
    mockSpawn.mockImplementation(() => makeFakeProc(0));

    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={onExit} />
    );
    // Navigate to Uninstall Plugin (index 2)
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('y/n');
    // Confirm
    stdin.write('y');
    await tick();
    // Should show Running state
    expect(lastFrame()).toContain('Running');
    // Wait for spawn to close + 800ms exit delay
    await tick(1000);
    expect(onExit).toHaveBeenCalled();
  });

  it('does not call onExit when Uninstall Plugin fails', async () => {
    const onExit = vi.fn();
    mockSpawn.mockImplementation(() => makeFakeProc(1));

    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={onExit} />
    );
    // Navigate to Uninstall Plugin (index 2)
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('y');
    await tick(200);
    // Should show error indicator
    expect(lastFrame()).toContain('\u2717');
    // onExit should NOT have been called
    expect(onExit).not.toHaveBeenCalled();
  });
});

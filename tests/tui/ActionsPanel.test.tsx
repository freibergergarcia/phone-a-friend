/**
 * Tests for ActionsPanel — grouped-by-host layout with async execution.
 *
 * Layout (top to bottom):
 *   Diagnostics → [Check Backends, Open Config]
 *   Claude Code → [Reinstall|Install, Uninstall]
 *   OpenCode    → [Reinstall|Install, Uninstall]
 *   Codex       → [Reinstall|Install, Uninstall]
 *
 * Action label is "Reinstall" or "Install" depending on isHostInstalled().
 * The test mocks all three host-install probes to false so labels are
 * deterministic.
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
  decorateOpenCodeModels: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  configPaths: vi.fn().mockReturnValue({
    user: '/home/test/.config/phone-a-friend/config.toml',
    repo: null,
  }),
  configInit: vi.fn(),
}));

vi.mock('../../src/installer.js', () => ({
  isPluginInstalled: vi.fn().mockReturnValue(false),
  isOpenCodeInstalled: vi.fn().mockReturnValue(false),
  isCodexInstalled: vi.fn().mockReturnValue(false),
}));

// Mock child_process.spawn so we can control subprocess actions
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
  it('shows all four group headers', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Diagnostics');
    expect(frame).toContain('Claude Code');
    expect(frame).toContain('OpenCode');
    expect(frame).toContain('Codex');
  });

  it('shows install-status badge per host group (not installed in this mock)', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    // All three hosts are mocked as not installed → 'not installed' badge appears
    expect(frame).toContain('not installed');
  });

  it('shows Diagnostics actions', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Check Backends');
    expect(frame).toContain('Open Config');
  });

  it('shows Install + Uninstall actions per host', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    const frame = lastFrame()!;
    // When isPluginInstalled returns false, label is "Install" (not "Reinstall")
    expect(frame).toContain('Install');
    expect(frame).toContain('Uninstall');
  });

  it('highlights first action (Check Backends) by default', () => {
    const { lastFrame } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    expect(lastFrame()).toContain('▸');
  });

  it('navigates with arrow keys', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    // Down: from Check Backends → Open Config
    stdin.write('[B');
    await tick();
    expect(lastFrame()).toContain('Open Config');
  });

  it('shows confirmation prompt when Enter is pressed on Uninstall action', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    // Flat action order:
    //   0: Diagnostics > Check Backends
    //   1: Diagnostics > Open Config
    //   2: Claude Code > Install
    //   3: Claude Code > Uninstall  ← target
    for (let i = 0; i < 3; i++) {
      stdin.write('[B');
      await tick();
    }
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('y/n');
  });

  it('cancels confirmation with n key', async () => {
    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={() => {}} />
    );
    for (let i = 0; i < 3; i++) {
      stdin.write('[B');
      await tick();
    }
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('y/n');
    stdin.write('n');
    await tick();
    expect(lastFrame()).not.toContain('y/n');
    expect(lastFrame()).toContain('Enter to run');
  });

  it('confirming y on Claude Uninstall runs action and calls onExit (exitAfter)', async () => {
    const onExit = vi.fn();
    mockSpawn.mockImplementation(() => makeFakeProc(0));

    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={onExit} />
    );
    for (let i = 0; i < 3; i++) {
      stdin.write('[B');
      await tick();
    }
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('y/n');
    stdin.write('y');
    await tick();
    expect(lastFrame()).toContain('Running');
    await tick(1000);
    expect(onExit).toHaveBeenCalled();
  });

  it('does not call onExit when Claude Uninstall fails', async () => {
    const onExit = vi.fn();
    mockSpawn.mockImplementation(() => makeFakeProc(1));

    const { lastFrame, stdin } = render(
      <ActionsPanel report={MOCK_REPORT} onRefresh={() => {}} onPluginRecheck={() => {}} onExit={onExit} />
    );
    for (let i = 0; i < 3; i++) {
      stdin.write('[B');
      await tick();
    }
    stdin.write('\r');
    await tick();
    stdin.write('y');
    await tick(200);
    expect(lastFrame()).toContain('✗');
    expect(onExit).not.toHaveBeenCalled();
  });
});

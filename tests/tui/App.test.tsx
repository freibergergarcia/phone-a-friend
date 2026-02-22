/**
 * Tests for the TUI App shell and tab navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// Mock detection so App doesn't do real system calls
vi.mock('../../src/detection.js', () => ({
  detectAll: vi.fn().mockResolvedValue({
    cli: [],
    local: [],
    api: [],
    host: [],
  }),
}));

// Mock version to avoid FS reads
vi.mock('../../src/version.js', () => ({
  getVersion: vi.fn().mockReturnValue('1.0.0-test'),
}));

import { App } from '../../src/tui/App.js';

const TAB_NAMES = ['Status', 'Backends', 'Config', 'Actions'];

// Helper: wait for React state updates to flush
const tick = () => new Promise((r) => setTimeout(r, 50));

describe('TUI App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { lastFrame } = render(<App />);
    expect(lastFrame()).toBeDefined();
  });

  it('shows all 4 tab names in the tab bar', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame()!;
    for (const name of TAB_NAMES) {
      expect(frame).toContain(name);
    }
  });

  it('shows Status content by default (scanning or system info)', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame()!;
    expect(frame).toMatch(/Scanning|System|Node/);
  });

  it('number keys jump to panels', async () => {
    const { lastFrame, stdin } = render(<App />);

    // Jump to Backends (tab 2) — shows real BackendsPanel
    stdin.write('2');
    await tick();
    expect(lastFrame()).toContain('Backends');

    // Jump to Config (tab 3)
    stdin.write('3');
    await tick();
    expect(lastFrame()).toContain('Config');

    // Jump to Actions (tab 4)
    stdin.write('4');
    await tick();
    expect(lastFrame()).toContain('Actions');
  });

  it('Tab key cycles through tabs', async () => {
    const { lastFrame, stdin } = render(<App />);

    // Start at Status (0), Tab to Backends (1)
    stdin.write('\t');
    await tick();
    expect(lastFrame()).toContain('Backends');

    // Tab to Config (2)
    stdin.write('\t');
    await tick();
    expect(lastFrame()).toContain('Config');

    // Tab to Actions (3)
    stdin.write('\t');
    await tick();
    expect(lastFrame()).toContain('Actions');

    // Tab wraps to Status (0)
    stdin.write('\t');
    await tick();
    expect(lastFrame()).toMatch(/Scanning|System|Node/);
  });

  it('shows keyboard hints in footer', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame()!;
    expect(frame).toContain('Tab');
    expect(frame).toContain('quit');
  });

  it('shows refresh hint only on Status and Backends tabs', async () => {
    const { lastFrame, stdin } = render(<App />);
    // Status tab — should show refresh
    expect(lastFrame()).toContain('refresh');

    // Config tab — should NOT show refresh
    stdin.write('3');
    await tick();
    expect(lastFrame()).not.toContain('refresh');

    // Backends tab — should show refresh
    stdin.write('2');
    await tick();
    expect(lastFrame()).toContain('refresh');

    // Actions tab — should NOT show refresh
    stdin.write('4');
    await tick();
    expect(lastFrame()).not.toContain('refresh');
  });
});

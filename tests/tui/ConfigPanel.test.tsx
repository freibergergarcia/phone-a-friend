/**
 * Tests for ConfigPanel — config display with inline editing.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    backends: {
      codex: { model: 'o3' },
      ollama: { host: 'http://localhost:11434', model: 'qwen3' },
    },
  }),
  configPaths: vi.fn().mockReturnValue({
    user: '/home/test/.config/phone-a-friend/config.toml',
    repo: null,
  }),
  configSet: vi.fn(),
  configInit: vi.fn(),
}));

import { ConfigPanel } from '../../src/tui/ConfigPanel.js';
import { configSet } from '../../src/config.js';

const tick = () => new Promise((r) => setTimeout(r, 50));
const mockConfigSet = vi.mocked(configSet);

describe('ConfigPanel', () => {
  it('shows config file path', () => {
    const { lastFrame } = render(<ConfigPanel />);
    expect(lastFrame()).toContain('config.toml');
  });

  it('shows default backend', () => {
    const { lastFrame } = render(<ConfigPanel />);
    expect(lastFrame()).toContain('codex');
  });

  it('shows default sandbox mode', () => {
    const { lastFrame } = render(<ConfigPanel />);
    expect(lastFrame()).toContain('read-only');
  });

  it('shows default timeout', () => {
    const { lastFrame } = render(<ConfigPanel />);
    expect(lastFrame()).toContain('600');
  });

  it('shows per-backend config', () => {
    const { lastFrame } = render(<ConfigPanel />);
    const frame = lastFrame()!;
    expect(frame).toContain('o3');
    expect(frame).toContain('qwen3');
  });

  it('shows navigation hints', () => {
    const { lastFrame } = render(<ConfigPanel />);
    expect(lastFrame()).toContain('edit');
  });

  it('Enter key starts editing with current value', async () => {
    const { lastFrame, stdin } = render(<ConfigPanel />);
    // Press Enter to edit first row (defaults.backend = codex)
    stdin.write('\r');
    await tick();
    // Should show editing hints
    expect(lastFrame()).toContain('Esc cancel');
  });

  it('Escape cancels editing', async () => {
    const { lastFrame, stdin } = render(<ConfigPanel />);
    stdin.write('\r'); // enter edit mode
    await tick();
    stdin.write('\u001B'); // escape
    await tick();
    // Should be back in navigation mode
    expect(lastFrame()).toContain('Arrow keys navigate');
  });

  it('shows section headers', () => {
    const { lastFrame } = render(<ConfigPanel />);
    const frame = lastFrame()!;
    expect(frame).toContain('Defaults');
    expect(frame).toContain('Backend: codex');
  });

  it('shows selection pointer', () => {
    const { lastFrame } = render(<ConfigPanel />);
    expect(lastFrame()).toContain('\u25b8');
  });

  it('toggles boolean field on Enter (include_diff)', async () => {
    mockConfigSet.mockClear();
    const { lastFrame, stdin } = render(<ConfigPanel />);
    // Navigate down to include_diff (index 3: backend=0, sandbox=1, timeout=2, include_diff=3)
    stdin.write('\u001B[B'); // down
    stdin.write('\u001B[B'); // down
    stdin.write('\u001B[B'); // down
    await tick();
    // Press Enter — should toggle false → true and save, NOT enter edit mode
    stdin.write('\r');
    await tick();
    // Should NOT show "Esc cancel" (edit mode), should show save message
    expect(lastFrame()).toContain('Saved');
    expect(lastFrame()).not.toContain('Esc cancel');
    // configSet should have been called with 'true'
    expect(mockConfigSet).toHaveBeenCalledWith(
      'defaults.include_diff',
      'true',
      expect.any(String),
    );
  });
});

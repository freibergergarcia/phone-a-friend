/**
 * Tests for ConfigPanel — read-only config display.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    backends: {
      codex: { model: 'o3' },
      openai: { model: 'gpt-4o', api_key_env: 'OPENAI_API_KEY' },
      ollama: { host: 'http://localhost:11434', model: 'qwen3' },
    },
  }),
  configPaths: vi.fn().mockReturnValue({
    user: '/home/test/.config/phone-a-friend/config.toml',
    repo: null,
  }),
}));

import { ConfigPanel } from '../../src/tui/ConfigPanel.js';

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
    expect(frame).toContain('gpt-4o');
    expect(frame).toContain('qwen3');
  });

  it('shows edit tip', () => {
    const { lastFrame } = render(<ConfigPanel />);
    expect(lastFrame()).toContain('config set');
  });
});

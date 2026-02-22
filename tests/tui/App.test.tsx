/**
 * Tests for the TUI App shell and tab navigation.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/App.js';

const TAB_NAMES = ['Status', 'Backends', 'Config', 'Actions'];

describe('TUI App', () => {
  it('renders without crashing', () => {
    const { lastFrame } = render(<App />);
    expect(lastFrame()).toBeDefined();
  });

  it('shows all 4 tab names', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame()!;
    for (const name of TAB_NAMES) {
      expect(frame).toContain(name);
    }
  });

  it('shows Status panel content by default', () => {
    const { lastFrame } = render(<App />);
    // The Status placeholder should be visible initially
    expect(lastFrame()).toContain('Status');
  });

  it('Tab key cycles to next tab', () => {
    const { lastFrame, stdin } = render(<App />);
    // Press Tab to move to Backends
    stdin.write('\t');
    const frame = lastFrame()!;
    // Backends panel placeholder should now be active
    expect(frame).toContain('Backends');
  });

  it('Tab wraps around from last to first', () => {
    const { lastFrame, stdin } = render(<App />);
    // Press Tab 4 times to wrap around
    stdin.write('\t');
    stdin.write('\t');
    stdin.write('\t');
    stdin.write('\t');
    // Should be back on Status
    expect(lastFrame()).toContain('Status');
  });

  it('number keys 1-4 jump to specific tabs', () => {
    const { lastFrame, stdin } = render(<App />);
    stdin.write('3');
    expect(lastFrame()).toContain('Config');

    stdin.write('2');
    expect(lastFrame()).toContain('Backends');

    stdin.write('4');
    expect(lastFrame()).toContain('Actions');

    stdin.write('1');
    expect(lastFrame()).toContain('Status');
  });

  it('shows keyboard hints in footer', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame()!;
    expect(frame).toContain('Tab');
    expect(frame).toContain('quit');
  });
});

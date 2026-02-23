/**
 * Tests for PluginStatusBar — renders installed/not-installed states.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PluginStatusBar } from '../../src/tui/components/PluginStatusBar.js';

describe('PluginStatusBar', () => {
  it('shows green installed state', () => {
    const { lastFrame } = render(<PluginStatusBar installed={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2713');
    expect(frame).toContain('Installed');
  });

  it('shows yellow not-installed state', () => {
    const { lastFrame } = render(<PluginStatusBar installed={false} />);
    const frame = lastFrame()!;
    expect(frame).toContain('!');
    expect(frame).toContain('Not Installed');
  });

  it('shows "Claude Plugin" label in both states', () => {
    const { lastFrame: installed } = render(<PluginStatusBar installed={true} />);
    expect(installed()).toContain('Claude Plugin');

    const { lastFrame: notInstalled } = render(<PluginStatusBar installed={false} />);
    expect(notInstalled()).toContain('Claude Plugin');
  });
});

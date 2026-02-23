/**
 * Smoke test: confirms TSX pipeline (React + Ink) compiles and renders.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

describe('TUI smoke test', () => {
  it('renders an Ink Text component', () => {
    const { lastFrame } = render(<Text>Hello TUI</Text>);
    expect(lastFrame()).toContain('Hello TUI');
  });
});

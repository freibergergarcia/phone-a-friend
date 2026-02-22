/**
 * Ink render entry point for the TUI dashboard.
 */

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

export async function renderTui(): Promise<number> {
  const { waitUntilExit } = render(<App />);
  try {
    await waitUntilExit();
    return 0;
  } catch {
    return 1;
  }
}

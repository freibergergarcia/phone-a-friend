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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`TUI error: ${message}\n`);
    return 1;
  }
}

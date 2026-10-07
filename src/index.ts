#!/usr/bin/env node

// Import all backends so they self-register
import './backends/antigravity.js';
import './backends/codex.js';
import './backends/gemini.js';
import './backends/ollama.js';
import './backends/claude.js';
import './backends/opencode.js';
import './backends/pi.js';

import { run } from './cli.js';

// Writes to a pipe are asynchronous, and process.exit() drops whatever the
// pipe has not taken yet: `task list --json` was cut at 64 KiB. Exit once
// stdout and stderr have flushed, still without waiting on other handles.
function exitWhenFlushed(code: number): void {
  process.exitCode = code;
  const streams = [process.stdout, process.stderr].filter((stream) => stream.writableLength > 0);
  if (streams.length === 0) process.exit(code);
  let pending = streams.length;
  const done = () => {
    pending -= 1;
    if (pending === 0) process.exit(code);
  };
  // A reader that never drains (a stopped pager) must not hold the exit forever.
  setTimeout(() => process.exit(code), 5_000).unref();
  for (const stream of streams) stream.write('', done);
}

run(process.argv.slice(2)).then(
  (code) => exitWhenFlushed(code),
  (err) => {
    console.error(err);
    exitWhenFlushed(1);
  },
);

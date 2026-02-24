#!/usr/bin/env node

// Import all backends so they self-register
import './backends/codex.js';
import './backends/gemini.js';
import './backends/ollama.js';
import './backends/claude.js';

import { run } from './cli.js';

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

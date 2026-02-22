#!/usr/bin/env node

// Import all backends so they self-register
import './backends/codex.js';
import './backends/gemini.js';

import { run } from './cli.js';

process.exit(run(process.argv.slice(2)));

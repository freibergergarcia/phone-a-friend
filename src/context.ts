/**
 * Relay context types.
 *
 * Ported from relay function signature in phone_a_friend/relay.py
 */

import type { SandboxMode } from './backends/index.js';

export interface RelayContext {
  backend: string;
  model: string | null;
  sandbox: SandboxMode;
  timeout: number;
  repoPath: string;
  includeDiff: boolean;
  prompt: string;
  contextFile: string | null;
  contextText: string | null;
}

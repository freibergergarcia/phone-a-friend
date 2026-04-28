import { describe, it, expect } from 'vitest';
import type { SandboxMode } from '../../src/backends/index.js';
import {
  buildOpenCodeArgs,
  isOpenCodeHostEnv,
  OPENCODE_BACKEND,
} from '../../src/backends/opencode.js';

function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'Review this code',
    repoPath: '/tmp/repo',
    timeoutSeconds: 60,
    sandbox: 'read-only' as SandboxMode,
    model: null as string | null,
    env: {} as Record<string, string>,
    ...overrides,
  };
}

describe('OpenCode backend', () => {
  it('builds basic opencode run args', () => {
    expect(buildOpenCodeArgs({
      prompt: 'hi',
      repoPath: '/repo',
      model: 'qwen3-coder',
      provider: 'ollama',
      fast: true,
      sessionId: null,
      resumeSession: false,
    })).toEqual([
      'run',
      '--format',
      'json',
      '--dir',
      '/repo',
      '--model',
      'ollama/qwen3-coder',
      '--pure',
      'hi',
    ]);
  });

  it('detects OpenCode host marker env', () => {
    expect(isOpenCodeHostEnv({ PHONE_A_FRIEND_HOST: 'opencode' })).toBe(true);
    expect(isOpenCodeHostEnv({ OPENCODE_SESSION_ID: 'session-1' })).toBe(true);
    expect(isOpenCodeHostEnv({ PHONE_A_FRIEND_HOST: 'claude' })).toBe(false);
  });

  it('blocks recursive OpenCode backend calls when OpenCode is the host', async () => {
    await expect(OPENCODE_BACKEND.run(makeOpts({
      env: { PHONE_A_FRIEND_HOST: 'opencode' },
    }))).rejects.toThrow(/OpenCode is already the host/);
  });
});

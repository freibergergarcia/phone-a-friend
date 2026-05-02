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
    expect(isOpenCodeHostEnv({ PHONE_A_FRIEND_HOST: 'claude' })).toBe(false);
    expect(isOpenCodeHostEnv({})).toBe(false);
  });

  it('does not block on bare OPENCODE_* env vars (previously a false-positive vector)', () => {
    // Users running their own OpenCode server may have OPENCODE_SERVER_PASSWORD
    // or similar in their shell rc. Those should NOT trigger the recursion
    // guard from a regular terminal — only PHONE_A_FRIEND_HOST does.
    expect(isOpenCodeHostEnv({ OPENCODE_SESSION_ID: 'session-1' })).toBe(false);
    expect(isOpenCodeHostEnv({ OPENCODE_SERVER_PASSWORD: 'secret' })).toBe(false);
    expect(isOpenCodeHostEnv({ OPENCODE_HOME: '/somewhere' })).toBe(false);
  });

  it('blocks recursive OpenCode backend calls when OpenCode is the host', async () => {
    await expect(OPENCODE_BACKEND.run(makeOpts({
      env: { PHONE_A_FRIEND_HOST: 'opencode' },
    }))).rejects.toThrow(/OpenCode is already the host/);
  });
});

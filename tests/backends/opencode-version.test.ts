import { describe, it, expect } from 'vitest';
import { parseOpenCodeMajor } from '../../src/backends/opencode.js';

/**
 * OpenCode ships two lines that both install as `opencode`:
 * 1.x (`opencode-ai`, what README/brew/docs install) and 2.x
 * (`@opencode/cli`). Their `run` flags differ, so PaF must know the major.
 * `opencode --version` output verified 2026-09-26:
 *   @opencode/cli 2.0.14  -> "opencode v2.0.14"
 *   @opencode-ai/cli beta -> "opencode2 v0.0.0-beta-17823"
 */
describe('parseOpenCodeMajor()', () => {
  it('reads the major from the 2.x banner', () => {
    expect(parseOpenCodeMajor('opencode v2.0.14\n')).toBe(2);
  });

  it('reads the major from a bare 1.x version string', () => {
    expect(parseOpenCodeMajor('1.18.32')).toBe(1);
  });

  it('returns null for a 0.x beta build so callers fail closed', () => {
    expect(parseOpenCodeMajor('opencode2 v0.0.0-beta-17823')).toBeNull();
  });

  it('returns null when no version is present', () => {
    expect(parseOpenCodeMajor('')).toBeNull();
    expect(parseOpenCodeMajor('Unrecognized flag: --version')).toBeNull();
  });
});

import { buildOpenCodeArgs, OpenCodeBackendError } from '../../src/backends/opencode.js';

const base = {
  prompt: 'hi',
  repoPath: '/repo',
  model: 'qwen3-coder',
  provider: 'ollama',
  fast: false,
  sessionId: null,
  resumeSession: false,
};

describe('buildOpenCodeArgs() per major', () => {
  it('keeps the 1.x argument vector byte-identical (--dir, --pure)', () => {
    expect(buildOpenCodeArgs({ ...base, fast: true, major: 1 })).toEqual([
      'run', '--format', 'json', '--dir', '/repo', '--model', 'ollama/qwen3-coder', '--pure', 'hi',
    ]);
  });

  it('omits --dir and --pure on 2.x, where the CLI rejects both', () => {
    // `opencode run --help` on @opencode/cli 2.0.14 lists neither flag.
    expect(buildOpenCodeArgs({ ...base, fast: true, major: 2 })).toEqual([
      'run', '--format', 'json', '--model', 'ollama/qwen3-coder', 'hi',
    ]);
  });

  it('adds --standalone on 2.x only when asked', () => {
    expect(buildOpenCodeArgs({ ...base, major: 2, standalone: true })).toEqual([
      'run', '--format', 'json', '--standalone', '--model', 'ollama/qwen3-coder', 'hi',
    ]);
    expect(buildOpenCodeArgs({ ...base, major: 1, standalone: true })).not.toContain('--standalone');
  });

  it('keeps session resume and title on both majors', () => {
    for (const major of [1, 2] as const) {
      const args = buildOpenCodeArgs({ ...base, major, sessionId: 'ses_1', resumeSession: true });
      expect(args).toContain('--session');
      expect(args[args.indexOf('--session') + 1]).toBe('ses_1');
      expect(args).not.toContain('--title');
    }
  });

  it('emits only neutral arguments when the major is unknown', () => {
    expect(buildOpenCodeArgs({ ...base, major: null })).toEqual([
      'run', '--format', 'json', '--model', 'ollama/qwen3-coder', 'hi',
    ]);
  });

  it('fails closed when a version-specific flag is requested and the major is unknown', () => {
    expect(() => buildOpenCodeArgs({ ...base, major: null, fast: true })).toThrow(OpenCodeBackendError);
    expect(() => buildOpenCodeArgs({ ...base, major: null, fast: true })).toThrow(/version/i);
    expect(() => buildOpenCodeArgs({ ...base, major: null, standalone: true })).toThrow(/version/i);
  });
});

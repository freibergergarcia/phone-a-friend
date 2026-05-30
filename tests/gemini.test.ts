import { describe, it, expect } from 'vitest';
import { buildGeminiArgs } from '../src/backends/gemini.js';

// Capability assertions live in tests/backends/gemini.test.ts. This file
// focuses on session-flag translation in the pure argument builder.
describe('buildGeminiArgs', () => {
  const base = {
    prompt: 'hello',
    repoPath: '/repo',
    sandbox: 'read-only' as const,
    model: null,
    useJsonOutput: false,
    sessionId: null,
    resumeSession: false,
  };

  it('builds a one-shot invocation with no session flags', () => {
    const args = buildGeminiArgs(base);
    expect(args).not.toContain('--session-id');
    expect(args).not.toContain('--resume');
    expect(args).toContain('--sandbox');
    expect(args).toContain('--yolo');
    expect(args).toEqual(expect.arrayContaining(['--include-directories', '/repo']));
    expect(args).toEqual(expect.arrayContaining(['--output-format', 'text']));
    expect(args).toEqual(expect.arrayContaining(['--prompt', 'hello']));
  });

  it('pins a new session with --session-id on the first call', () => {
    const args = buildGeminiArgs({ ...base, sessionId: 'abc-123', resumeSession: false });
    const idx = args.indexOf('--session-id');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('abc-123');
    expect(args).not.toContain('--resume');
  });

  it('resumes an existing session with --resume on later calls', () => {
    const args = buildGeminiArgs({ ...base, sessionId: 'abc-123', resumeSession: true });
    const idx = args.indexOf('--resume');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('abc-123');
    expect(args).not.toContain('--session-id');
    // Deterministic id, never "latest".
    expect(args).not.toContain('latest');
  });

  it('ignores resumeSession when no session id is present', () => {
    const args = buildGeminiArgs({ ...base, sessionId: null, resumeSession: true });
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--session-id');
  });

  it('drops --sandbox for danger-full-access and forwards json + model', () => {
    const args = buildGeminiArgs({
      ...base,
      sandbox: 'danger-full-access',
      useJsonOutput: true,
      model: 'gemini-2.5-pro',
    });
    expect(args).not.toContain('--sandbox');
    expect(args).toEqual(expect.arrayContaining(['--output-format', 'json']));
    expect(args).toEqual(expect.arrayContaining(['-m', 'gemini-2.5-pro']));
  });
});

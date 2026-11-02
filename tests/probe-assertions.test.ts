import { describe, expect, it } from 'vitest';
import { assertProbeOutput } from '../scripts/assert-probe.mjs';

describe('live probe acceptance assertions', () => {
  it.each(['oneshot', 'stream', 'fast', 'job-result'])('%s rejects refusals, protocol leakage, and wrong answers', name => {
    expect(() => assertProbeOutput(name, 'PONG\n')).not.toThrow();
    for (const output of ['', 'PING', 'I cannot return PONG', '{"text":"PONG"}', 'PONGPONG']) {
      expect(() => assertProbeOutput(name, output)).toThrow();
    }
  });

  it('requires actual recall and schema values, not merely text or parseable JSON', () => {
    expect(() => assertProbeOutput('sess2', 'MARMALADE')).not.toThrow();
    expect(() => assertProbeOutput('sess2', 'I do not remember')).toThrow();
    expect(() => assertProbeOutput('schema', '{"word":"PONG","ok":true}')).not.toThrow();
    for (const output of ['{}', '{"word":"PONG","ok":false}', '{"word":"PONG","ok":true,"extra":1}', '```json\n{}\n```']) {
      expect(() => assertProbeOutput('schema', output)).toThrow();
    }
  });

  it('does not pass an empty or unrelated review verdict for the buggy fixture', () => {
    const verdict = {
      schema_version: 1, verdict: 'iterate', summary: 'Arithmetic regression',
      findings: [{ severity: 'important', title: 'Restore addition', rationale: 'math.js now subtracts instead of adding.', location: 'math.js:2' }],
    };
    expect(() => assertProbeOutput('verdict', JSON.stringify(verdict))).not.toThrow();
    expect(() => assertProbeOutput('verdict', JSON.stringify({
      ...verdict, summary: 'Addition was replaced by subtraction.',
      findings: [{ ...verdict.findings[0], rationale: 'add(2, 3) returns -1 instead of 5.' }],
    }))).not.toThrow();
    expect(() => assertProbeOutput('verdict', JSON.stringify({ ...verdict, verdict: 'ship', findings: [] }))).toThrow();
    expect(() => assertProbeOutput('verdict', JSON.stringify({ ...verdict, findings: [{ ...verdict.findings[0], severity: 'nit' }] }))).toThrow();
    expect(() => assertProbeOutput('review', 'math.js subtracts instead of adding.')).not.toThrow();
    expect(() => assertProbeOutput('review', 'The add function now performs subtraction instead of addition.')).not.toThrow();
    expect(() => assertProbeOutput('review', 'Everything looks good.')).toThrow();
  });

  it('checks session identity and the correct persistence strategy', () => {
    const session = { id: 'probe', backend: 'claude', repoPath: '/fixture', backendSessionId: 'native-id', history: [] };
    const check = (rows: unknown) => assertProbeOutput('session-list', JSON.stringify(rows), { backend: 'claude', repo: '/fixture' });
    expect(() => check([session])).not.toThrow();
    expect(() => check([])).toThrow();
    expect(() => check([{ ...session, repoPath: '/wrong' }])).toThrow();
    expect(() => check([{ ...session, backendSessionId: null }])).toThrow();
    expect(() => check([{ ...session, history: ['unexpected transcript'] }])).toThrow();
  });

  it('requires task records and rejects unknown assertion names', () => {
    expect(() => assertProbeOutput('task-list', '[]', { backend: 'claude', repo: '/fixture' })).toThrow();
    expect(() => assertProbeOutput('typo', 'PONG')).toThrow(/Unknown probe assertion/);
  });
});

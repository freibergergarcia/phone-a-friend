/**
 * Tests for agentic message parser.
 */

import { describe, it, expect } from 'vitest';
import { parseAgentResponse, buildSystemPrompt } from '../../src/agentic/parser.js';

const AGENTS = new Set(['security', 'perf', 'quality', 'all', 'user']);

describe('parseAgentResponse', () => {
  it('extracts single @mention message', () => {
    const result = parseAgentResponse('@perf: Is this N+1 query slow?', AGENTS);
    expect(result.messages).toEqual([
      { to: 'perf', content: 'Is this N+1 query slow?' },
    ]);
    expect(result.notes).toBe('');
  });

  it('extracts multiple @mention messages', () => {
    const text = [
      '@perf: Check the token refresh query.',
      '@quality: Verify test coverage for auth.',
    ].join('\n');

    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ to: 'perf', content: 'Check the token refresh query.' });
    expect(result.messages[1]).toEqual({ to: 'quality', content: 'Verify test coverage for auth.' });
  });

  it('handles @all broadcast', () => {
    const result = parseAgentResponse('@all: Summary of findings.', AGENTS);
    expect(result.messages).toEqual([
      { to: 'all', content: 'Summary of findings.' },
    ]);
  });

  it('handles @user final output', () => {
    const result = parseAgentResponse('@user: Here is the final report.', AGENTS);
    expect(result.messages).toEqual([
      { to: 'user', content: 'Here is the final report.' },
    ]);
  });

  it('separates notes from messages', () => {
    const text = [
      'Let me analyze the code first.',
      '',
      '@perf: Found a potential bottleneck in line 42.',
      '',
      'I should also check the cache layer.',
    ].join('\n');

    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].to).toBe('perf');
    expect(result.notes).toContain('Let me analyze the code first.');
    expect(result.notes).toContain('I should also check the cache layer.');
  });

  it('skips @mentions inside fenced code blocks', () => {
    const text = [
      'Here is an example:',
      '```',
      '@perf: this should not be extracted',
      '```',
      '@security: This should be extracted.',
    ].join('\n');

    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].to).toBe('security');
    expect(result.notes).toContain('@perf: this should not be extracted');
  });

  it('skips @mentions inside blockquotes', () => {
    const text = [
      '> @perf: quoted message should not be extracted',
      '@quality: This should be extracted.',
    ].join('\n');

    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].to).toBe('quality');
  });

  it('ignores @mentions for unknown agents', () => {
    const text = '@unknown: This should be treated as notes.';
    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(0);
    expect(result.notes).toContain('@unknown: This should be treated as notes.');
  });

  it('handles multi-line messages (continuation)', () => {
    const text = [
      '@perf: Found an issue with the query.',
      'It runs 340ms per call which is too slow.',
      'Recommend batch fetching instead.',
      '',
      '@security: Also check the auth token.',
    ].join('\n');

    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toContain('340ms per call');
    expect(result.messages[0].content).toContain('batch fetching');
    expect(result.messages[1].to).toBe('security');
  });

  it('handles empty input', () => {
    const result = parseAgentResponse('', AGENTS);
    expect(result.messages).toHaveLength(0);
    expect(result.notes).toBe('');
  });

  it('handles all-notes response (no mentions)', () => {
    const text = 'I analyzed the code and found nothing concerning.\nAll looks good.';
    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(0);
    expect(result.notes).toContain('I analyzed the code');
  });

  it('handles indented code blocks', () => {
    const text = [
      '@perf: Check this code:',
      '',
      '  ```typescript',
      '  @security: not a mention',
      '  ```',
      '',
      '@quality: Separate message.',
    ].join('\n');

    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].to).toBe('perf');
    expect(result.messages[1].to).toBe('quality');
  });

  it('does not extract @mentions mid-line', () => {
    const text = 'I think @perf should look at this.';
    const result = parseAgentResponse(text, AGENTS);
    expect(result.messages).toHaveLength(0);
    expect(result.notes).toContain('I think @perf should look at this.');
  });
});

describe('buildSystemPrompt', () => {
  it('includes role and other agents', () => {
    const prompt = buildSystemPrompt('security', ['security', 'perf', 'quality']);
    expect(prompt).toContain('"security"');
    expect(prompt).toContain('perf, quality');
    expect(prompt).toContain('@perf:');
  });

  it('includes role description when provided', () => {
    const prompt = buildSystemPrompt('security', ['security', 'perf'], 'Find vulnerabilities');
    expect(prompt).toContain('Find vulnerabilities');
  });

  it('falls back to role name when no description', () => {
    const prompt = buildSystemPrompt('security', ['security', 'perf']);
    expect(prompt).toContain('Stay focused on your role: security');
  });
});

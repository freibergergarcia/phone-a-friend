import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePiJsonl, PiBackendError } from '../../src/backends/pi.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pi');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

const HEADER =
  '{"type":"session","version":3,"id":"abc","timestamp":"2026-09-30T00:00:00.000Z","cwd":"/repo"}';

function assistantEnd(message: Record<string, unknown>): string {
  return JSON.stringify({ type: 'message_end', message: { role: 'assistant', ...message } });
}

function stream(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('parsePiJsonl() against captured pi 0.87.1 streams', () => {
  it('returns the trimmed final text and the session header', () => {
    const parsed = parsePiJsonl(fixture('session-start.jsonl'));
    // The captured text block is "\n\nOK" after a thinking block.
    expect(parsed.text).toBe('OK');
    expect(parsed.header).toEqual({
      id: '11111111-2222-4333-8444-555555555555',
      cwd: '/private/tmp/paf-pi-step0/repo',
      timestamp: '2026-09-30T07:21:04.039Z',
    });
  });

  it('never returns thinking text', () => {
    const parsed = parsePiJsonl(fixture('session-start.jsonl'));
    expect(parsed.text).not.toMatch(/remember a secret word/);
  });

  it('reads a resumed session, whose header is the original one', () => {
    const start = parsePiJsonl(fixture('session-start.jsonl'));
    const resume = parsePiJsonl(fixture('session-resume.jsonl'));
    expect(resume.text).toBe('MARMALADE');
    expect(resume.header).toEqual(start.header);
  });

  it('answers with the last assistant message after tool calls', () => {
    const parsed = parsePiJsonl(fixture('tool-calls.jsonl'));
    expect(parsed.text.startsWith('I was unable to create the file.')).toBe(true);
    expect(parsed.text).toContain('`read` - Read file contents');
  });

  it('throws on stopReason "error" even though pi exited 0', () => {
    expect(() => parsePiJsonl(fixture('error-exit-zero.jsonl'))).toThrow(PiBackendError);
    expect(() => parsePiJsonl(fixture('error-exit-zero.jsonl'))).toThrow(/404/);
  });

  it('throws the final error after auto-retries and points at the local server', () => {
    const run = () => parsePiJsonl(fixture('retry-connection-error.jsonl'));
    expect(run).toThrow(PiBackendError);
    expect(run).toThrow(/Connection error\./);
    expect(run).toThrow(/check the server is up/);
  });

  it('throws on an aborted response (synthetic fixture)', () => {
    const run = () => parsePiJsonl(fixture('aborted.synthetic.jsonl'));
    expect(run).toThrow(PiBackendError);
    expect(run).toThrow(/Request was aborted\./);
  });

  it('throws when the stream ends on a toolUse message instead of an answer', () => {
    // Cut the real stream right after its first assistant message, which
    // asked for a tool: what a run that died mid-loop would leave behind.
    const lines = fixture('tool-calls.jsonl').split('\n');
    const firstAssistantEnd = lines.findIndex((line) => {
      if (!line.includes('"message_end"')) return false;
      const record = JSON.parse(line) as { type: string; message?: { role?: string } };
      return record.type === 'message_end' && record.message?.role === 'assistant';
    });
    expect(firstAssistantEnd).toBeGreaterThan(0);
    const cut = lines.slice(0, firstAssistantEnd + 1).join('\n');
    expect(() => parsePiJsonl(cut)).toThrow(/toolUse/);
  });
});

describe('parsePiJsonl() end-state rules', () => {
  it('accepts "length" as a (truncated) answer', () => {
    const out = stream(HEADER, assistantEnd({ content: [{ type: 'text', text: 'partial' }], stopReason: 'length' }));
    expect(parsePiJsonl(out).text).toBe('partial');
  });

  it('throws on a stop reason it does not know, naming it', () => {
    for (const stopReason of ['pending', 'deferred', 'something-new']) {
      const out = stream(HEADER, assistantEnd({ content: [{ type: 'text', text: 'hi' }], stopReason }));
      expect(() => parsePiJsonl(out)).toThrow(new RegExp(stopReason));
    }
  });

  it('throws when the stop reason is missing', () => {
    const out = stream(HEADER, assistantEnd({ content: [{ type: 'text', text: 'hi' }] }));
    expect(() => parsePiJsonl(out)).toThrow(PiBackendError);
  });

  it('throws when the final message has no text', () => {
    const empty = stream(HEADER, assistantEnd({ content: [], stopReason: 'stop' }));
    expect(() => parsePiJsonl(empty)).toThrow(/no text output/);
    const whitespace = stream(HEADER, assistantEnd({ content: [{ type: 'text', text: '\n\n ' }], stopReason: 'stop' }));
    expect(() => parsePiJsonl(whitespace)).toThrow(/no text output/);
    const thinkingOnly = stream(
      HEADER,
      assistantEnd({ content: [{ type: 'thinking', thinking: 'hmm' }], stopReason: 'stop' }),
    );
    expect(() => parsePiJsonl(thinkingOnly)).toThrow(/no text output/);
  });

  it('throws when content is not an array', () => {
    const out = stream(HEADER, assistantEnd({ content: 'a string', stopReason: 'stop' }));
    expect(() => parsePiJsonl(out)).toThrow(PiBackendError);
  });

  it('never falls back to an earlier assistant message', () => {
    const out = stream(
      HEADER,
      assistantEnd({ content: [{ type: 'text', text: 'an earlier answer' }], stopReason: 'stop' }),
      assistantEnd({ content: [], stopReason: 'error', errorMessage: 'boom' }),
    );
    expect(() => parsePiJsonl(out)).toThrow(/boom/);
  });

  it('falls back to the stop reason when an error carries no message', () => {
    const out = stream(HEADER, assistantEnd({ content: [], stopReason: 'aborted' }));
    expect(() => parsePiJsonl(out)).toThrow(/aborted/);
  });

  it('throws when there is no assistant message at all, with the stderr tail', () => {
    const out = stream(HEADER, '{"type":"agent_start"}');
    expect(() => parsePiJsonl(out)).toThrow(/no assistant message/);
    expect(() => parsePiJsonl(out, { stderr: 'line one\nError: something broke' })).toThrow(/something broke/);
    expect(() => parsePiJsonl('')).toThrow(/no assistant message/);
  });

  it('joins several text blocks in order and ignores other block types', () => {
    const out = stream(
      HEADER,
      assistantEnd({
        content: [
          { type: 'thinking', thinking: 'private' },
          { type: 'text', text: 'first' },
          { type: 'toolCall', id: 't1', name: 'read', arguments: {} },
          { type: 'text', text: 'second' },
        ],
        stopReason: 'stop',
      }),
    );
    expect(parsePiJsonl(out).text).toBe('first\nsecond');
  });

  it('ignores assistant text in records other than message_end', () => {
    const out = stream(
      HEADER,
      JSON.stringify({ type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text: 'from turn_end' }], stopReason: 'stop' } }),
      JSON.stringify({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'from user' }] } }),
    );
    expect(() => parsePiJsonl(out)).toThrow(/no assistant message/);
  });

  it('returns a null header when the stream has none', () => {
    const out = stream(assistantEnd({ content: [{ type: 'text', text: 'hi' }], stopReason: 'stop' }));
    const parsed = parsePiJsonl(out);
    expect(parsed.text).toBe('hi');
    expect(parsed.header).toBeNull();
  });
});

describe('parsePiJsonl() framing', () => {
  it('handles CRLF line endings', () => {
    const crlf = fixture('session-start.jsonl').replace(/\n/g, '\r\n');
    expect(parsePiJsonl(crlf).text).toBe('OK');
  });

  it('does not treat U+2028 or U+2029 inside a string as a record break', () => {
    // JSON.stringify leaves both separators unescaped, as pi's stream does.
    const text = 'before middle after';
    const line = assistantEnd({ content: [{ type: 'text', text }], stopReason: 'stop' });
    expect(line).toContain(' ');
    expect(parsePiJsonl(stream(HEADER, line)).text).toBe(text);
  });

  it('skips blank lines, non-JSON noise and JSON values that are not objects', () => {
    const out = [
      '',
      'Warning: some diagnostic that leaked onto stdout',
      HEADER,
      '5',
      '"a string"',
      'null',
      '[1,2]',
      '   ',
      assistantEnd({ content: [{ type: 'text', text: 'hi' }], stopReason: 'stop' }),
      '{"truncated":',
    ].join('\n');
    const parsed = parsePiJsonl(out);
    expect(parsed.text).toBe('hi');
    expect(parsed.header?.id).toBe('abc');
  });

  it('parses a stream with no trailing newline', () => {
    const out = [HEADER, assistantEnd({ content: [{ type: 'text', text: 'hi' }], stopReason: 'stop' })].join('\n');
    expect(parsePiJsonl(out).text).toBe('hi');
  });
});

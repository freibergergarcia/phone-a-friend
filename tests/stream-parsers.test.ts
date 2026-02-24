import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { parseSSEStream, parseNDJSONStream, parseClaudeStreamJSON } from '../src/stream-parsers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function mockNDJSONStream(lines: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
      }
      controller.close();
    },
  });
}

async function collect(gen: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// SSE parser
// ---------------------------------------------------------------------------

describe('parseSSEStream', () => {
  it('yields content from multi-chunk stream', async () => {
    const events = [
      JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
      JSON.stringify({ choices: [{ delta: { content: ' world' } }] }),
    ];
    const chunks = await collect(parseSSEStream(mockSSEStream(events)));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('terminates on [DONE]', async () => {
    const events = [
      JSON.stringify({ choices: [{ delta: { content: 'token' } }] }),
    ];
    const chunks = await collect(parseSSEStream(mockSSEStream(events)));
    expect(chunks).toEqual(['token']);
  });

  it('skips SSE comment lines', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const chunks = await collect(parseSSEStream(body));
    expect(chunks).toEqual(['hi']);
  });

  it('skips non-data fields (event:, id:, retry:)', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: message\n'));
        controller.enqueue(encoder.encode('id: 123\n'));
        controller.enqueue(encoder.encode('retry: 5000\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const chunks = await collect(parseSSEStream(body));
    expect(chunks).toEqual(['ok']);
  });

  it('skips role-only first chunks', async () => {
    const events = [
      JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'hello' } }] }),
    ];
    const chunks = await collect(parseSSEStream(mockSSEStream(events)));
    expect(chunks).toEqual(['hello']);
  });

  it('skips empty content chunks', async () => {
    const events = [
      JSON.stringify({ choices: [{ delta: { content: '' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'data' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ];
    const chunks = await collect(parseSSEStream(mockSSEStream(events)));
    expect(chunks).toEqual(['data']);
  });

  it('throws on error payload mid-stream', async () => {
    const events = [
      JSON.stringify({ choices: [{ delta: { content: 'start' } }] }),
      JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit' } }),
    ];
    await expect(collect(parseSSEStream(mockSSEStream(events)))).rejects.toThrow('Stream error');
  });

  it('throws on premature close without [DONE]', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`));
        controller.close(); // No [DONE]
      },
    });
    await expect(collect(parseSSEStream(body))).rejects.toThrow('Stream ended unexpectedly');
  });

  it('skips malformed JSON lines', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {not valid json}\n\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const chunks = await collect(parseSSEStream(body));
    expect(chunks).toEqual(['ok']);
  });

  it('handles UTF-8 split across chunks', async () => {
    const encoder = new TextEncoder();
    const fullEvent = `data: ${JSON.stringify({ choices: [{ delta: { content: '\u{1F600}' } }] })}\n\n`;
    const encoded = encoder.encode(fullEvent);
    // Split in the middle of the UTF-8 sequence
    const mid = Math.floor(encoded.length / 2);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, mid));
        controller.enqueue(encoded.slice(mid));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const chunks = await collect(parseSSEStream(body));
    expect(chunks).toEqual(['\u{1F600}']);
  });

  it('processes final line without trailing newline (buffer flush)', async () => {
    const encoder = new TextEncoder();
    // [DONE] terminator without trailing newline
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })}\n\ndata: [DONE]`
        ));
        controller.close();
      },
    });
    const chunks = await collect(parseSSEStream(body));
    expect(chunks).toEqual(['hello']);
  });

  it('throws on abort signal', async () => {
    const ac = new AbortController();
    const encoder = new TextEncoder();
    let enqueueMore: (() => void) | undefined;

    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        // First chunk delivered immediately
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\n`));
        // Second chunk delivered after abort
        enqueueMore = () => {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'b' } }] })}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        };
      },
    });

    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of parseSSEStream(body, ac.signal)) {
        chunks.push(chunk);
        ac.abort();
        enqueueMore?.();
      }
    }).rejects.toThrow('Stream aborted');
    expect(chunks).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// NDJSON parser
// ---------------------------------------------------------------------------

describe('parseNDJSONStream', () => {
  it('yields content from tokens with done:false', async () => {
    const lines = [
      { message: { content: 'Hello' }, done: false },
      { message: { content: ' world' }, done: false },
      { done: true },
    ];
    const chunks = await collect(parseNDJSONStream(mockNDJSONStream(lines)));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('terminates on done:true', async () => {
    const lines = [
      { message: { content: 'token' }, done: false },
      { done: true },
    ];
    const chunks = await collect(parseNDJSONStream(mockNDJSONStream(lines)));
    expect(chunks).toEqual(['token']);
  });

  it('throws on error object mid-stream', async () => {
    const lines = [
      { message: { content: 'start' }, done: false },
      { error: 'model not found' },
    ];
    await expect(collect(parseNDJSONStream(mockNDJSONStream(lines)))).rejects.toThrow('Stream error: model not found');
  });

  it('throws on premature close without done:true', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n'));
        controller.close(); // No done:true
      },
    });
    await expect(collect(parseNDJSONStream(body))).rejects.toThrow('Stream ended unexpectedly');
  });

  it('skips empty content lines', async () => {
    const lines = [
      { message: { content: '' }, done: false },
      { message: { content: 'data' }, done: false },
      { done: true },
    ];
    const chunks = await collect(parseNDJSONStream(mockNDJSONStream(lines)));
    expect(chunks).toEqual(['data']);
  });

  it('skips malformed JSON lines', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('not json\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'ok' }, done: false }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
        controller.close();
      },
    });
    const chunks = await collect(parseNDJSONStream(body));
    expect(chunks).toEqual(['ok']);
  });

  it('processes final line without trailing newline (buffer flush)', async () => {
    const encoder = new TextEncoder();
    // done:true line without trailing newline
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          JSON.stringify({ message: { content: 'hello' }, done: false }) + '\n' +
          JSON.stringify({ done: true })
        ));
        controller.close();
      },
    });
    const chunks = await collect(parseNDJSONStream(body));
    expect(chunks).toEqual(['hello']);
  });

  it('throws on abort signal', async () => {
    const ac = new AbortController();
    const encoder = new TextEncoder();
    let enqueueMore: (() => void) | undefined;

    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode(JSON.stringify({ message: { content: 'a' }, done: false }) + '\n'));
        enqueueMore = () => {
          ctrl.enqueue(encoder.encode(JSON.stringify({ message: { content: 'b' }, done: false }) + '\n'));
          ctrl.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
          ctrl.close();
        };
      },
    });

    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of parseNDJSONStream(body, ac.signal)) {
        chunks.push(chunk);
        ac.abort();
        enqueueMore?.();
      }
    }).rejects.toThrow('Stream aborted');
    expect(chunks).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// Claude stream-json parser
// ---------------------------------------------------------------------------

function mockClaudeStream(lines: object[]): Readable {
  const text = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  return Readable.from([text]);
}

describe('parseClaudeStreamJSON', () => {
  it('yields content from assistant messages with de-duplication', async () => {
    const stream = mockClaudeStream([
      { type: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      { type: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
    ]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    // "Hello" then " world" (delta from snapshot)
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('yields content from result message', async () => {
    const stream = mockClaudeStream([
      { type: 'result', result: 'Final answer' },
    ]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks).toEqual(['Final answer']);
  });

  it('de-duplicates result after assistant messages', async () => {
    const stream = mockClaudeStream([
      { type: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
      { type: 'result', result: 'Hello world' },
    ]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    // Result is same length as already emitted — no new content
    expect(chunks).toEqual(['Hello world']);
  });

  it('handles nested message.content structure', async () => {
    const stream = mockClaudeStream([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'nested' }] } },
    ]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks).toEqual(['nested']);
  });

  it('handles multiple text blocks in a single message', async () => {
    const stream = mockClaudeStream([
      { type: 'assistant', content: [
        { type: 'text', text: 'Part 1. ' },
        { type: 'text', text: 'Part 2.' },
      ] },
    ]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks).toEqual(['Part 1. Part 2.']);
  });

  it('skips non-text content blocks', async () => {
    const stream = mockClaudeStream([
      { type: 'assistant', content: [
        { type: 'tool_use', id: '123', name: 'Read' },
        { type: 'text', text: 'actual text' },
      ] },
    ]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks).toEqual(['actual text']);
  });

  it('throws on error payload', async () => {
    const stream = mockClaudeStream([
      { error: { message: 'API overloaded' } },
    ]);
    await expect(collect(parseClaudeStreamJSON(stream))).rejects.toThrow('Stream error');
  });

  it('skips malformed JSON lines', async () => {
    const text = 'not json\n' + JSON.stringify({ type: 'result', result: 'ok' }) + '\n';
    const stream = Readable.from([text]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks).toEqual(['ok']);
  });

  it('skips unknown message types', async () => {
    const stream = mockClaudeStream([
      { type: 'system', content: 'some system info' },
      { type: 'assistant', content: [{ type: 'text', text: 'visible' }] },
    ]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks).toEqual(['visible']);
  });

  it('handles empty stream without throwing', async () => {
    const stream = Readable.from(['']);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks).toEqual([]);
  });

  it('handles chunked delivery (split across reads)', async () => {
    const line1 = JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'chunk' }] });
    const line2 = JSON.stringify({ type: 'result', result: 'chunk test' });
    const full = line1 + '\n' + line2 + '\n';
    const mid = Math.floor(full.length / 2);

    const stream = Readable.from([full.slice(0, mid), full.slice(mid)]);
    const chunks = await collect(parseClaudeStreamJSON(stream));
    expect(chunks.join('')).toBe('chunk test');
  });
});

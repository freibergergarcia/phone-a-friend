/**
 * Stream parsers for HTTP backend streaming responses.
 *
 * - parseSSEStream: OpenAI-compatible Server-Sent Events (used by a8c-proxy)
 * - parseNDJSONStream: Newline-delimited JSON (used by Ollama)
 * - parseClaudeStreamJSON: Claude --output-format stream-json (used by Claude backend)
 */

// ---------------------------------------------------------------------------
// SSE parser — OpenAI-compatible (single-line data: events only)
//
// Note: The SSE spec allows multi-line data: events (joined by newlines on a
// blank-line boundary). This parser only handles single-line data: events,
// which is all that OpenAI-compatible APIs produce. Multi-line data: payloads
// would be skipped as malformed JSON fragments.
// ---------------------------------------------------------------------------

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedDone = false;

  function* processSSELines(lines: string[]): Generator<string> {
    for (const line of lines) {
      const trimmed = line.trimEnd();

      // Skip empty lines (SSE event boundaries)
      if (trimmed === '') continue;

      // Skip SSE comments (keep-alive heartbeats)
      if (trimmed.startsWith(':')) continue;

      // Skip non-data fields (event:, id:, retry:)
      if (trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:')) continue;

      // Must be a data line
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();

      // Terminator
      if (payload === '[DONE]') {
        receivedDone = true;
        return;
      }

      // Parse JSON
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        // Skip malformed JSON
        continue;
      }

      // Error detection
      if (parsed.error) {
        throw new Error(`Stream error: ${JSON.stringify(parsed.error)}`);
      }

      // Extract content from choices[0].delta.content
      const choices = parsed.choices as { delta?: { content?: string } }[] | undefined;
      const content = choices?.[0]?.delta?.content;
      if (typeof content === 'string' && content.length > 0) {
        yield content;
      }
    }
  }

  try {
    while (true) {
      if (signal?.aborted) throw new Error('Stream aborted');

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete last line

      for (const token of processSSELines(lines)) {
        if (signal?.aborted) throw new Error('Stream aborted');
        yield token;
      }
      if (receivedDone) return;
    }

    // Flush any remaining buffered content (final line without trailing newline)
    if (buffer.trim()) {
      yield* processSSELines([buffer]);
    }
  } finally {
    reader.releaseLock();
  }

  if (!receivedDone) {
    throw new Error('Stream ended unexpectedly');
  }
}

// ---------------------------------------------------------------------------
// NDJSON parser — Ollama
// ---------------------------------------------------------------------------

export async function* parseNDJSONStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedDone = false;

  function* processNDJSONLines(lines: string[]): Generator<string> {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        // Skip malformed JSON
        continue;
      }

      // Error detection
      if (parsed.error) {
        throw new Error(`Stream error: ${String(parsed.error)}`);
      }

      // Terminator
      if (parsed.done === true) {
        receivedDone = true;
        return;
      }

      // Extract content from message.content
      const message = parsed.message as { content?: string } | undefined;
      const content = message?.content;
      if (typeof content === 'string' && content.length > 0) {
        yield content;
      }
    }
  }

  try {
    while (true) {
      if (signal?.aborted) throw new Error('Stream aborted');

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const token of processNDJSONLines(lines)) {
        if (signal?.aborted) throw new Error('Stream aborted');
        yield token;
      }
      if (receivedDone) return;
    }

    // Flush any remaining buffered content (final line without trailing newline)
    if (buffer.trim()) {
      yield* processNDJSONLines([buffer]);
    }
  } finally {
    reader.releaseLock();
  }

  if (!receivedDone) {
    throw new Error('Stream ended unexpectedly');
  }
}

// ---------------------------------------------------------------------------
// Claude stream-json parser — Node Readable
//
// Claude's `--output-format stream-json` emits NDJSON lines to stdout.
// Each line is a JSON object with a `type` field. Content appears in messages
// of type "assistant". The final result message has type "result".
//
// With `--include-partial-messages`, partial content chunks arrive as they
// stream. We track cumulative text length and only yield new characters
// (de-duplication for snapshot-style events).
// ---------------------------------------------------------------------------

import type { Readable } from 'node:stream';

export async function* parseClaudeStreamJSON(
  stdout: Readable,
): AsyncGenerator<string> {
  let buffer = '';
  let emittedLength = 0;

  function* processLines(lines: string[]): Generator<string> {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        // Skip malformed JSON lines
        continue;
      }

      // Error detection
      if (parsed.error) {
        throw new Error(`Stream error: ${JSON.stringify(parsed.error)}`);
      }

      const type = parsed.type as string | undefined;

      // Final result message: { type: "result", result: "full text" }
      if (type === 'result') {
        const result = parsed.result as string | undefined;
        if (typeof result === 'string' && result.length > emittedLength) {
          yield result.slice(emittedLength);
          emittedLength = result.length;
        }
        continue;
      }

      // Content block delta: incremental text from --include-partial-messages
      // { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
      // Or wrapped: { type: "stream_event", event: { type: "content_block_delta", ... } }
      const inner = type === 'stream_event'
        ? (parsed.event as Record<string, unknown> | undefined)
        : parsed;
      const innerType = (inner?.type as string | undefined) ?? type;

      if (innerType === 'content_block_delta') {
        const delta = (inner as Record<string, unknown>).delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
          emittedLength += delta.text.length;
          yield delta.text;
        }
        continue;
      }

      // Assistant messages (snapshot-style): { type: "assistant", content: [{ type: "text", text: "..." }] }
      // Or nested: { type: "assistant", message: { content: [...] } }
      if (innerType === 'assistant' || innerType === 'message') {
        const message = ((inner as Record<string, unknown>)?.message ?? inner) as Record<string, unknown>;
        const contentBlocks = message.content as { type?: string; text?: string }[] | undefined;

        if (Array.isArray(contentBlocks)) {
          let fullText = '';
          for (const block of contentBlocks) {
            if (block.type === 'text' && typeof block.text === 'string') {
              fullText += block.text;
            }
          }

          // De-duplicate: only yield characters beyond what we've already emitted
          if (fullText.length > emittedLength) {
            yield fullText.slice(emittedLength);
            emittedLength = fullText.length;
          }
        }
      }
    }
  }

  for await (const chunk of stdout) {
    buffer += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf-8');

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    yield* processLines(lines);
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    yield* processLines([buffer]);
  }
}

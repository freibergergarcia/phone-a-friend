import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XaiBackend, XaiBackendError } from '../../src/backends/xai.js';
import type { BackendRunOptions } from '../../src/backends/index.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/xai/response.json', import.meta.url), 'utf8'));
const key = 'fake-xai-key-for-tests';
const backend = new XaiBackend();
const mockFetch = vi.fn();
function opts(overrides: Partial<BackendRunOptions> = {}): BackendRunOptions {
  return { prompt: 'Hello', repoPath: '/tmp/xai-test', timeoutSeconds: 60,
    sandbox: 'read-only', model: null, env: { XAI_API_KEY: key }, ...overrides };
}
function response(text = 'Hello', annotations: unknown[] = []) {
  return { status: 'completed', error: null, output: [{ type: 'message', content: [{ type: 'output_text', text, annotations }] }] };
}
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset().mockResolvedValue(Response.json(response()));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('xAI Responses backend', () => {
  it('sends both search tools, the default model, history, and only header auth', async () => {
    const sessionHistory = [{ role: 'user' as const, content: 'First' }, { role: 'assistant' as const, content: 'Reply' }];
    expect(await backend.run(opts({ sessionHistory }))).toBe('Hello');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/responses');
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(JSON.parse(init.body)).toEqual({ model: 'grok-4.6', input: [...sessionHistory, { role: 'user', content: 'Hello' }], tools: [{ type: 'web_search' }, { type: 'x_search' }], stream: false, store: false });
    expect(init.body).not.toContain(key);
  });

  it('trims whitespace from the authentication key', async () => {
    await backend.run(opts({ env: { XAI_API_KEY: ' key\n' } }));
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer key');
  });

  it('uses the resolved model override', async () => {
    await backend.run(opts({ model: 'grok-4.5' }));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).model).toBe('grok-4.5');
  });

  it('extracts the captured answer and cited source, excluding reasoning and tool calls', async () => {
    mockFetch.mockResolvedValue(Response.json(fixture));
    const expected = fixture.output.find((i: { type: string }) => i.type === 'message').content[0];
    expect(await backend.run(opts())).toBe(`${expected.text}\n\nSources:\n- ${expected.annotations[0].url}`);
  });

  it('joins message parts and deduplicates citation URLs in first-seen order', async () => {
    const a = { type: 'url_citation', url: 'https://a.test' };
    const b = { type: 'url_citation', url: 'https://b.test' };
    const data = response('One', [b, a, b]);
    data.output.push(...response('Two', [a]).output);
    mockFetch.mockResolvedValue(Response.json(data));
    expect(await backend.run(opts())).toBe('One\nTwo\n\nSources:\n- https://b.test\n- https://a.test');
  });

  it('sends native schema output without changing the prompt or adding a Sources footer', async () => {
    mockFetch.mockResolvedValue(Response.json(response('{"ok":true}', [{ type: 'url_citation', url: 'https://a.test' }])));
    const schema = '{"type":"object"}';
    expect(JSON.parse(await backend.run(opts({ schema })))).toEqual({ ok: true });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(body.text.format).toEqual({ type: 'json_schema', name: 'paf_response', schema: JSON.parse(schema), strict: true });
  });

  it.each(['not json', '[]'])('rejects a non-object schema before calling xAI (%s)', async schema => {
    await expect(backend.run(opts({ schema }))).rejects.toThrow('--schema must be a JSON object for xai');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])('requires a nonempty key (%s)', async value => {
    await expect(backend.run(opts({ env: value === undefined ? {} : { XAI_API_KEY: value } }))).rejects.toThrow(/XAI_API_KEY.*https:\/\/console.x.ai/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('truncates HTTP errors after redacting keys across the truncation boundary', async () => {
    mockFetch.mockResolvedValue(new Response(`${'x'.repeat(190)}${key}${'x'.repeat(40)}`, { status: 401 }));
    const error = await backend.run(opts()).catch(e => e);
    expect(error).toBeInstanceOf(XaiBackendError);
    expect(error.message).toBe(`xAI returned HTTP 401: ${'x'.repeat(190)}[REDACTED]`);
    for (let i = 0; i <= key.length - 8; i++) {
      expect(error.message).not.toContain(key.slice(i, i + 8));
    }
    expect(error.message).not.toContain(key);
    expect(error.message.length).toBeLessThan(300);
    expect(error.cause).toBeUndefined();
  });

  it.each(['failed', 'incomplete', 'in_progress'])('rejects response status %s', async status => {
    mockFetch.mockResolvedValue(Response.json({ status, error: null }));
    const error = await backend.run(opts()).catch(e => e);
    expect(error.message).toBe(`xAI response failed: status=${status}`);
  });

  it('reports bounded, redacted status, incomplete reason, and API error detail', async () => {
    mockFetch.mockResolvedValue(Response.json({ ...response(),
      incomplete_details: { reason: 'max_output_tokens' },
      error: { code: 'quota', message: `${key}${'x'.repeat(300)}` },
    }));
    const error = await backend.run(opts()).catch(e => e);
    const detail = 'status=completed; reason=max_output_tokens; code=quota; message=[REDACTED]';
    expect(error.message).toBe(`xAI response failed: ${detail}${'x'.repeat(200 - detail.length)}`);
    expect(error.message).not.toContain(key);
  });

  it.each([
    { status: 'completed', output: [] },
    { status: 'completed', output: [{ type: 'reasoning', summary: [{ text: 'Private' }] }, { type: 'custom_tool_call' }] },
  ])('rejects completed responses without answer text (%j)', async data => {
    mockFetch.mockResolvedValue(Response.json(data));
    await expect(backend.run(opts())).rejects.toThrow(/^xAI completed without producing output$/);
  });

  it('rejects invalid JSON without exposing the body', async () => {
    mockFetch.mockResolvedValue(new Response(key));
    const error = await backend.run(opts()).catch(e => e);
    expect(error.message).toBe('xAI returned invalid JSON (HTTP 200)');
    expect(error.message).not.toContain(key);
  });

  it('distinguishes a body-read failure from invalid JSON', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => { throw new Error(key); } });
    const error = await backend.run(opts()).catch(e => e);
    expect(error.message).toBe('xAI response body could not be read (HTTP 200)');
    expect(error.message).not.toContain(key);
  });

  it('reports a timeout during body read', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation((_url, init) => Promise.resolve({ ok: true, status: 200,
      text: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    }));
    const assertion = expect(backend.run(opts({ timeoutSeconds: 1 }))).rejects.toThrow('xAI timed out after 1s');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('does not expose transport error details or credentials', async () => {
    mockFetch.mockRejectedValue(new Error(`Authorization: Bearer ${key}`));
    await expect(backend.run(opts())).rejects.toThrow(/^xAI request failed$/);
  });

  it('aborts a timed out fetch', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const result = backend.run(opts({ timeoutSeconds: 1 }));
    const assertion = expect(result).rejects.toThrow('xAI timed out after 1s');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

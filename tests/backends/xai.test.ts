import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XaiBackend, XaiBackendError } from '../../src/backends/xai.js';
import type { BackendRunOptions } from '../../src/backends/index.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/xai/response.json', import.meta.url), 'utf8'));
const key = 'fake-xai-key-for-tests';
const backend = new XaiBackend();
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock('../../src/backends/http-fetch.js', () => ({ longFetch: mockFetch }));
function opts(overrides: Partial<BackendRunOptions> = {}): BackendRunOptions {
  return { prompt: 'Hello', repoPath: '/tmp/xai-test', timeoutSeconds: 60,
    sandbox: 'read-only', model: null, env: { XAI_API_KEY: key }, ...overrides };
}
function response(text = 'Hello', annotations: unknown[] = []) {
  return { status: 'completed', error: null, output: [{ type: 'message', content: [{ type: 'output_text', text, annotations }] }] };
}
beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(Response.json(response()));
});
afterEach(() => { vi.useRealTimers(); });

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

  it('redacts a key written with JSON escapes in an error body', async () => {
    const escaped = `\\u00${key.charCodeAt(0).toString(16)}${key.slice(1)}`;
    mockFetch.mockResolvedValue(new Response(`{"error":"Invalid key: ${escaped}"}`, { status: 401 }));
    const error = await backend.run(opts()).catch(e => e);
    expect(error.message).toBe('xAI returned HTTP 401: {"error":"Invalid key: [REDACTED]"}');
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

  it('sets no time limit when timeoutSeconds is 0', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(async (_url, init) => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
      return Response.json(response());
    });
    const result = backend.run(opts({ timeoutSeconds: 0 }));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe('Hello');
  });

  it('sets no timer at all when timeoutSeconds is 0', async () => {
    vi.useFakeTimers();
    let timersDuringRequest = -1;
    mockFetch.mockImplementation(async () => { timersDuringRequest = vi.getTimerCount(); return Response.json(response()); });
    await backend.run(opts({ timeoutSeconds: 0 }));
    expect(timersDuringRequest).toBe(0);
  });

  it.each(['tool', 'user', 'system'])('leaves %s messages out of the answer', async role => {
    const message = (from: string, text: string) => ({ type: 'message', role: from, content: [{ type: 'output_text', text, annotations: [] }] });
    mockFetch.mockResolvedValue(Response.json({ status: 'completed', error: null, output: [message(role, 'Not the answer'), message('assistant', '{"ok":true}')] }));
    expect(JSON.parse(await backend.run(opts({ schema: '{"type":"object"}' })))).toEqual({ ok: true });
  });

  it('keeps an answer that arrives next to a refusal', async () => {
    mockFetch.mockResolvedValue(Response.json({ status: 'completed', error: null, output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }, { type: 'output_text', text: 'Answer', annotations: [] }] }] }));
    expect(await backend.run(opts())).toBe('Answer');
  });

  it('reports a refusal with its reason, bounded and redacted', async () => {
    mockFetch.mockResolvedValue(Response.json({ status: 'completed', error: null, output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: `No, ${key}` }] }] }));
    await expect(backend.run(opts())).rejects.toThrow(/^xAI refused: No, \[REDACTED\]$/);
  });

  it('does not expose transport error details or credentials', async () => {
    mockFetch.mockRejectedValue(new Error(`Authorization: Bearer ${key}`));
    await expect(backend.run(opts())).rejects.toThrow(/^xAI request failed$/);
  });

  it.each([
    ['fetch cause', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }, 'UND_ERR_HEADERS_TIMEOUT'],
    ['node error', { code: 'ECONNRESET' }, 'ECONNRESET'],
  ])('names the transport failure from a %s, without its message', async (_shape, fields, code) => {
    mockFetch.mockRejectedValue(Object.assign(new Error(`Bearer ${key}`), fields));
    await expect(backend.run(opts())).rejects.toThrow(new RegExp(`^xAI request failed: ${code}$`));
  });

  it.each([`not a code ${key}`, 'x'.repeat(50), 'A'.repeat(50)])('drops a transport code that is not a code (%s)', async code => {
    mockFetch.mockRejectedValue(Object.assign(new Error(key), { code }));
    await expect(backend.run(opts())).rejects.toThrow(/^xAI request failed$/);
  });

  it('redacts a transport code equal to the key', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('x'), { code: 'FAKEKEY' }));
    await expect(backend.run(opts({ env: { XAI_API_KEY: 'FAKEKEY' } }))).rejects.toThrow(/^xAI request failed: \[REDACTED\]$/);
  });

  it.each([
    ['a diff in the prompt', { prompt: 'Review\n\nGit Diff:\n+secret' }],
    ['context in the prompt', { prompt: 'Review\n\nAdditional Context:\nsecret' }],
    ['a pasted git diff', { prompt: 'Why?\ndiff --git a/x b/x\n+secret' }],
    ['CRLF line endings', { prompt: 'Review\r\nGit Diff:\r\n+secret' }],
    ['a diff in replayed history', { sessionHistory: [{ role: 'user' as const, content: 'Look\n\nGit Diff:\n+secret' }, { role: 'assistant' as const, content: 'ok' }] }],
    ['context in replayed history', { sessionHistory: [{ role: 'user' as const, content: 'Look\n\nAdditional Context:\nsecret' }, { role: 'assistant' as const, content: 'ok' }] }],
  ])('sends no search tools with %s', async (_where, overrides) => {
    const notice = vi.spyOn(console, 'error').mockImplementation(() => {});
    await backend.run(opts(overrides));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).tools).toBeUndefined();
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('search are off'));
    notice.mockRestore();
  });

  it.each(['What does "Git Diff:" mean?', 'Is Additional Context: a good heading?', 'What does diff --git do?'])('keeps search for a mention in passing (%s)', async prompt => {
    await backend.run(opts({ prompt }));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).tools).toHaveLength(2);
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

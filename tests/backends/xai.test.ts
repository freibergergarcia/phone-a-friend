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
    expect(JSON.parse(init.body)).toEqual({ model: 'grok-4.6', input: [...sessionHistory, { role: 'user', content: 'Hello' }], tools: [{ type: 'web_search' }, { type: 'x_search' }], stream: false });
    expect(init.body).not.toContain(key);
    expect(backend.localFileAccess).toBe(false);
    expect(backend.capabilities.resumeStrategy).toBe('transcript-replay');
    expect([...backend.allowedSandboxes]).toHaveLength(3);
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

  it('injects schema and keeps the answer parseable without a Sources footer', async () => {
    mockFetch.mockResolvedValue(Response.json(response('{"ok":true}', [{ type: 'url_citation', url: 'https://a.test' }])));
    const schema = '{"type":"object"}';
    expect(JSON.parse(await backend.run(opts({ schema })))).toEqual({ ok: true });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).input[0].content).toContain(schema);
  });

  it.each([undefined, '', '   '])('requires a nonempty key (%s)', async value => {
    await expect(backend.run(opts({ env: value === undefined ? {} : { XAI_API_KEY: value } }))).rejects.toThrow(/XAI_API_KEY.*https:\/\/console.x.ai/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('bounds and redacts HTTP errors', async () => {
    mockFetch.mockResolvedValue(new Response(`invalid ${key} ${'x'.repeat(400)}`, { status: 401 }));
    const error = await backend.run(opts()).catch(e => e);
    expect(error).toBeInstanceOf(XaiBackendError);
    expect(error.message).toContain('HTTP 401: invalid [REDACTED]');
    expect(error.message).not.toContain(key);
    expect(error.message.length).toBeLessThan(300);
    expect(error.cause).toBeUndefined();
  });

  it.each(['failed', 'incomplete', 'in_progress'])('rejects response status %s', async status => {
    mockFetch.mockResolvedValue(Response.json({ status, error: null }));
    const error = await backend.run(opts()).catch(e => e);
    expect(error.message).toBe('xAI response failed');
  });

  it('rejects non-null errors even when status is completed', async () => {
    mockFetch.mockResolvedValue(Response.json({ ...response(), error: { message: 'failed' } }));
    await expect(backend.run(opts())).rejects.toThrow('response failed');
  });

  it.each([null, {}, { status: 'completed', output: [] }])('rejects missing output (%j)', async data => {
    mockFetch.mockResolvedValue(Response.json(data));
    await expect(backend.run(opts())).rejects.toBeInstanceOf(XaiBackendError);
  });

  it('rejects invalid JSON without exposing the body', async () => {
    mockFetch.mockResolvedValue(new Response(key));
    await expect(backend.run(opts())).rejects.toThrow('invalid JSON (HTTP 200)');
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

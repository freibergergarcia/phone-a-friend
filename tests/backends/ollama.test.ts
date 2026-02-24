/**
 * Tests for OllamaBackend — HTTP API backend using native fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { OllamaBackend, OllamaBackendError } from '../../src/backends/ollama.js';

function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'Hello Ollama',
    repoPath: '/tmp/test-repo',
    timeoutSeconds: 60,
    sandbox: 'read-only' as const,
    model: null as string | null,
    env: {} as Record<string, string>,
    ...overrides,
  };
}

function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('OllamaBackend', () => {
  const backend = new OllamaBackend();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('has correct name and sandbox support', () => {
    expect(backend.name).toBe('ollama');
    expect(backend.allowedSandboxes.has('read-only')).toBe(true);
    expect(backend.allowedSandboxes.has('workspace-write')).toBe(true);
    expect(backend.allowedSandboxes.has('danger-full-access')).toBe(true);
  });

  it('sends prompt and returns content', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { role: 'assistant', content: 'Hello from Ollama!' },
    }));

    const result = await backend.run(makeOpts());
    expect(result).toBe('Hello from Ollama!');
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain('Hello Ollama');
  });

  it('passes model when provided via --model', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { content: 'response' },
    }));

    await backend.run(makeOpts({ model: 'qwen3' }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('qwen3');
  });

  it('resolves model from OLLAMA_MODEL env when --model not set', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { content: 'response' },
    }));

    await backend.run(makeOpts({ env: { OLLAMA_MODEL: 'llama3.2' } }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3.2');
  });

  it('omits model when neither --model nor env set', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { content: 'response' },
    }));

    await backend.run(makeOpts());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBeUndefined();
  });

  it('--model takes precedence over OLLAMA_MODEL env', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { content: 'response' },
    }));

    await backend.run(makeOpts({ model: 'qwen3', env: { OLLAMA_MODEL: 'llama3.2' } }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('qwen3');
  });

  it('uses OLLAMA_HOST from env', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { content: 'response' },
    }));

    await backend.run(makeOpts({ env: { OLLAMA_HOST: 'http://remote:8080' } }));
    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe('http://remote:8080/api/chat');
  });

  it('strips trailing slashes from host', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { content: 'response' },
    }));

    await backend.run(makeOpts({ env: { OLLAMA_HOST: 'http://localhost:11434///' } }));
    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe('http://localhost:11434/api/chat');
  });

  it('throws on empty response content', async () => {
    mockFetch.mockResolvedValue(mockResponse({
      message: { content: '' },
    }));

    await expect(backend.run(makeOpts())).rejects.toThrow(OllamaBackendError);
    await expect(backend.run(makeOpts())).rejects.toThrow('without producing output');
  });

  it('throws on missing message in response', async () => {
    mockFetch.mockResolvedValue(mockResponse({}));

    await expect(backend.run(makeOpts())).rejects.toThrow('without producing output');
  });

  it('throws on error field in response', async () => {
    mockFetch.mockResolvedValue(mockResponse({
      error: 'model "nonexistent" not found',
    }));

    await expect(backend.run(makeOpts())).rejects.toThrow(OllamaBackendError);
    await expect(backend.run(makeOpts())).rejects.toThrow('model "nonexistent" not found');
  });

  it('throws on non-2xx HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(backend.run(makeOpts())).rejects.toThrow(/HTTP 503/);
  });

  it('throws on non-2xx with empty body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => { throw new Error('read failed'); },
    });

    await expect(backend.run(makeOpts())).rejects.toThrow('HTTP 500');
  });

  it('throws on invalid JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    await expect(backend.run(makeOpts())).rejects.toThrow('invalid JSON');
  });

  it('throws timeout error on abort', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);
    // Also mock the diagnostic probe to fail
    mockFetch.mockRejectedValueOnce(new Error('probe fail'));

    await expect(backend.run(makeOpts({ timeoutSeconds: 5 }))).rejects.toThrow(
      'timed out after 5s',
    );
  });

  it('throws reachability error when server is down', async () => {
    const connError = new Error('fetch failed');
    mockFetch.mockRejectedValue(connError);

    await expect(backend.run(makeOpts())).rejects.toThrow('not reachable');
    await expect(backend.run(makeOpts())).rejects.toThrow('Is Ollama running?');
  });

  it('throws request-failed when server is reachable but chat fails', async () => {
    const chatError = new Error('bad request');
    mockFetch.mockRejectedValueOnce(chatError);
    // Diagnostic probe succeeds
    mockFetch.mockResolvedValueOnce({ ok: true });

    await expect(backend.run(makeOpts())).rejects.toThrow('request failed');
  });

  it('trims whitespace from response content', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      message: { content: '  trimmed response  \n' },
    }));

    const result = await backend.run(makeOpts());
    expect(result).toBe('trimmed response');
  });
});

// ---------------------------------------------------------------------------
// runStream()
// ---------------------------------------------------------------------------

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

function mockStreamResponse(lines: object[], ok = true, status = 200) {
  return {
    ok,
    status,
    body: mockNDJSONStream(lines),
    text: async () => '',
  };
}

async function collectStream(gen: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('OllamaBackend.runStream', () => {
  const backend = new OllamaBackend();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('yields tokens from NDJSON stream', async () => {
    const lines = [
      { message: { content: 'Hello' }, done: false },
      { message: { content: ' world' }, done: false },
      { done: true },
    ];
    mockFetch.mockResolvedValueOnce(mockStreamResponse(lines));

    const chunks = await collectStream(backend.runStream(makeOpts()));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('sends stream:true in request body', async () => {
    const lines = [
      { message: { content: 'ok' }, done: false },
      { done: true },
    ];
    mockFetch.mockResolvedValueOnce(mockStreamResponse(lines));

    await collectStream(backend.runStream(makeOpts()));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      body: null,
      text: async () => 'Service Unavailable',
    });

    await expect(collectStream(backend.runStream(makeOpts()))).rejects.toThrow(/HTTP 503/);
  });

  it('throws on timeout (abort)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);
    mockFetch.mockRejectedValueOnce(new Error('probe fail'));

    await expect(collectStream(backend.runStream(makeOpts({ timeoutSeconds: 5 })))).rejects.toThrow(
      'timed out after 5s',
    );
  });

  it('throws on null response body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
      text: async () => '',
    });

    await expect(collectStream(backend.runStream(makeOpts()))).rejects.toThrow('empty response body');
  });

  it('throws on mid-stream error object', async () => {
    const lines = [
      { message: { content: 'start' }, done: false },
      { error: 'model not found' },
    ];
    mockFetch.mockResolvedValueOnce(mockStreamResponse(lines));

    await expect(collectStream(backend.runStream(makeOpts()))).rejects.toThrow('Stream error: model not found');
  });

  it('reports timeout as "timed out" when abort fires mid-stream', async () => {
    // Simulate a stream that aborts when the timeout controller fires,
    // mimicking how a real HTTP connection behaves on abort.
    const encoder = new TextEncoder();

    mockFetch.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          // Deliver one chunk, then stall
          ctrl.enqueue(encoder.encode(JSON.stringify({ message: { content: 'start' }, done: false }) + '\n'));
          // When abort fires, error the stream (simulates HTTP connection abort)
          if (signal) {
            signal.addEventListener('abort', () => {
              try { ctrl.error(new DOMException('Aborted', 'AbortError')); } catch { /* already closed */ }
            });
          }
        },
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        body,
        text: async () => '',
      });
    });

    const streamPromise = collectStream(backend.runStream(makeOpts({ timeoutSeconds: 0.05 })));
    await expect(streamPromise).rejects.toThrow('timed out');
  });
});

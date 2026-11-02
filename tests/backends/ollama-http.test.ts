/** A real local server: the behaviour under test is what `node:http` does. */
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, constants, createGzip, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { ollamaFetch } from '../../src/backends/ollama-http.js';

let server: http.Server | null = null;

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`;
}

const call = (url: string, signal = new AbortController().signal) => ollamaFetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"hello":"world"}',
  signal,
});

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  server = null;
});

describe('ollamaFetch', () => {
  it('sends the method, headers and body, and returns a standard Response', async () => {
    const seen: { method?: string; type?: string; body: string } = { body: '' };
    const url = await serve((req, res) => {
      seen.method = req.method;
      seen.type = req.headers['content-type'];
      req.on('data', (c) => { seen.body += c; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"ok":true}');
      });
    });
    const resp = await call(url);
    expect(seen).toEqual({ method: 'POST', type: 'application/json', body: '{"hello":"world"}' });
    expect(resp.ok).toBe(true);
    expect(resp.headers.get('content-type')).toBe('application/json');
    expect(await resp.json()).toEqual({ ok: true });
  });

  it('reports an error status with its body', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 404;
      res.end('model not found');
    });
    const resp = await call(url);
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(404);
    expect(await resp.text()).toBe('model not found');
  });

  it('handles a status that cannot have a body', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    const resp = await call(url);
    expect(resp.status).toBe(204);
    expect(resp.body).toBeNull();
  });

  it('rejects a status outside 200-599 instead of crashing (#206)', async () => {
    // `new Response` throws a RangeError for such a status, and a throw inside
    // the http callback never reached the promise — the process died before
    // the task tracker recorded the failure. A raw TCP server, as the issue
    // suggests: node:http is not expected to emit a 700 itself.
    const raw = net.createServer((socket) => {
      socket.once('data', () => {
        socket.end('HTTP/1.1 700 Nonstandard\r\nContent-Length: 5\r\n\r\nhello');
      });
    });
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));
    try {
      const port = (raw.address() as AddressInfo).port;
      await expect(
        ollamaFetch(`http://127.0.0.1:${port}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"hello":"world"}',
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('Unsupported HTTP status 700');
    } finally {
      await new Promise((resolve) => raw.close(resolve));
    }
  });

  it.each([307, 308])('follows a %i redirect and keeps the POST and its body', async (status) => {
    const seen: { method?: string; body: string } = { body: '' };
    const url = await serve((req, res) => {
      if (req.url === '/api/chat') {
        res.writeHead(status, { Location: '/moved' });
        res.end();
        return;
      }
      seen.method = req.method;
      req.on('data', (c) => { seen.body += c; });
      req.on('end', () => res.end('{"ok":true}'));
    });
    const resp = await call(url);
    expect(seen).toEqual({ method: 'POST', body: '{"hello":"world"}' });
    expect(await resp.json()).toEqual({ ok: true });
  });

  it('stops following a redirect loop', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(307, { Location: '/api/chat' });
      res.end();
    });
    await expect(call(url)).rejects.toThrow(/Too many redirects/);
  });

  it('does not follow a redirect to another protocol', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(307, { Location: 'file:///etc/passwd' });
      res.end();
    });
    await expect(call(url)).rejects.toThrow(/Refusing to follow/);
  });

  it.each([
    ['gzip', gzipSync],
    ['x-gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
    ['GZip', gzipSync],
  ] as const)('decodes a %s response, as fetch does', async (encoding, compress) => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': encoding, 'Content-Type': 'application/json' });
      res.end(compress(Buffer.from('{"ok":true}')));
    });
    const resp = await call(url);
    expect(resp.headers.get('content-encoding')).toBeNull();
    expect(await resp.json()).toEqual({ ok: true });
  });

  it('delivers compressed chunks as they arrive, before the response ends', async () => {
    let finish = (): void => {};
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      const gzip = createGzip();
      gzip.pipe(res);
      gzip.write('first\n');
      gzip.flush(constants.Z_SYNC_FLUSH);
      finish = () => gzip.end('second\n');
    });
    const resp = await call(url);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe('first\n');
    finish();
    expect(decoder.decode((await reader.read()).value)).toBe('second\n');
    expect((await reader.read()).done).toBe(true);
  });

  it('asks for encodings it can decode', async () => {
    let accept: string | undefined;
    const url = await serve((req, res) => {
      accept = req.headers['accept-encoding'];
      res.end();
    });
    await call(url);
    expect(accept).toBe('gzip, deflate, br');
  });

  it('fails the read on a corrupt compressed body', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end('not gzip');
    });
    const resp = await call(url);
    await expect(resp.text()).rejects.toBeDefined();
  });

  it('fails a compressed body read when the limit fires mid-response', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      const gzip = createGzip();
      gzip.pipe(res);
      gzip.write('partial');
      gzip.flush(constants.Z_SYNC_FLUSH);
    });
    const controller = new AbortController();
    const resp = await call(url, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(resp.text()).rejects.toBeDefined();
  });

  it('rejects a malformed redirect location instead of crashing', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(307, { Location: 'http://' });
      res.end();
    });
    await expect(call(url)).rejects.toThrow(/Invalid redirect location/);
  });

  it('returns a redirect that would turn the POST into a GET as an error status', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(301, { Location: '/moved' });
      res.end();
    });
    expect((await call(url)).status).toBe(301);
  });

  it('delivers streamed chunks as they arrive, before the response ends', async () => {
    let finish = (): void => {};
    const url = await serve((_req, res) => {
      res.write('first\n');
      finish = () => res.end('second\n');
    });
    const resp = await call(url);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe('first\n');
    finish();
    expect(decoder.decode((await reader.read()).value)).toBe('second\n');
    expect((await reader.read()).done).toBe(true);
  });

  it('rejects with AbortError when the limit fires before the response starts', async () => {
    const url = await serve(() => { /* never answers */ });
    const controller = new AbortController();
    const pending = call(url, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fails a body read when the limit fires mid-response', async () => {
    const url = await serve((_req, res) => { res.write('partial'); });
    const controller = new AbortController();
    const resp = await call(url, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(resp.text()).rejects.toBeDefined();
  });

  it('rejects when the server is not reachable', async () => {
    const url = await serve((_req, res) => res.end());
    await new Promise((resolve) => server!.close(resolve));
    server = null;
    await expect(call(url)).rejects.toThrow(/ECONNREFUSED/);
  });
});

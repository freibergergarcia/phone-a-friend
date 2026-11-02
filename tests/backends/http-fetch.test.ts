/** A real local server: the behaviour under test is what `node:http` does. */
import http, { type IncomingHttpHeaders } from 'node:http';
import { brotliCompressSync, constants, createGzip, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer as netCreateServer, type AddressInfo } from 'node:net';
import { longFetch } from '../../src/backends/http-fetch.js';

let server: http.Server | null = null;

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`;
}

const call = (url: string, signal = new AbortController().signal) => longFetch(url, {
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

describe('longFetch', () => {
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

describe('longFetch credentials on redirects', () => {
  const secrets = { Authorization: 'Bearer k', Cookie: 'c=1', 'Proxy-Authorization': 'Basic p' };

  async function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
    const local = http.createServer(handler);
    await new Promise<void>(r => local.listen(0, '127.0.0.1', r));
    return { port: (local.address() as AddressInfo).port, close: () => local.close() };
  }
  const post = (url: string, headers: Record<string, string>) => longFetch(url, { method: 'POST', headers, body: '{}', signal: new AbortController().signal });

  it.each([
    ['another host', 'localhost'],
    ['another port on the same host', '127.0.0.1'],
  ])('drops every credential header on a redirect to %s', async (_name, host) => {
    const seen: IncomingHttpHeaders[] = [];
    const target = await listen((req, res) => { seen.push(req.headers); req.resume(); res.end('{}'); });
    const first = await listen((req, res) => { req.resume(); res.writeHead(307, { location: `http://${host}:${target.port}/` }); res.end(); });
    await (await post(`http://127.0.0.1:${first.port}/`, { ...secrets, 'Content-Type': 'application/json' })).text();
    first.close(); target.close();
    expect(seen).toHaveLength(1);
    expect(seen[0]['content-type']).toBe('application/json');
    for (const name of ['authorization', 'cookie', 'proxy-authorization']) expect(seen[0][name]).toBeUndefined();
  });

  it('matches credential header names in any case', async () => {
    const seen: IncomingHttpHeaders[] = [];
    const target = await listen((req, res) => { seen.push(req.headers); req.resume(); res.end('{}'); });
    const first = await listen((req, res) => { req.resume(); res.writeHead(308, { location: `http://127.0.0.1:${target.port}/` }); res.end(); });
    await (await post(`http://127.0.0.1:${first.port}/`, { AUTHORIZATION: 'Bearer k' })).text();
    first.close(); target.close();
    expect(seen).toHaveLength(1);
    expect(seen[0].authorization).toBeUndefined();
  });

  it('keeps credential headers on a same-origin redirect', async () => {
    const hits: (string | undefined)[] = [];
    const server = await listen((req, res) => {
      hits.push(req.headers.authorization); req.resume();
      if (req.url === '/') { res.writeHead(307, { location: '/moved' }); res.end(); } else res.end('{}');
    });
    await (await post(`http://127.0.0.1:${server.port}/`, secrets)).text();
    server.close();
    expect(hits).toEqual(['Bearer k', 'Bearer k']);
  });

  it('rejects, rather than crashing, on a status Response cannot represent', async () => {
    const raw = netCreateServer(c => { c.once('data', () => c.end('HTTP/1.1 700 Odd\r\nContent-Length: 2\r\n\r\n{}')); });
    await new Promise<void>(r => raw.listen(0, '127.0.0.1', r));
    await expect(post(`http://127.0.0.1:${(raw.address() as AddressInfo).port}/`, {})).rejects.toThrow('Unsupported HTTP status 700');
    raw.close();
  });
});

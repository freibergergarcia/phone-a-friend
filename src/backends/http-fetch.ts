/**
 * `fetch` with no limit of its own, for backends whose answers can take minutes.
 *
 * Node's built-in `fetch` gives up after 300s without response headers, and
 * after 300s between body chunks. A slow model or a long search passes both,
 * and the run then fails with "fetch failed" whatever `--timeout` says. Replacing those limits needs the `undici` package, whose
 * dispatchers are tied to the Node version's own copy, so this uses `node:http`
 * and hands back a standard `Response`. `--timeout` is the only limit.
 */
import http from 'node:http';
import https from 'node:https';
import { pipeline, Readable, type Transform } from 'node:stream';
import { constants, createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/** Statuses that `new Response()` refuses a body for. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
/** The redirects that keep a POST and its body. `fetch` turns the others into a GET, which `/api/chat` rejects. */
const BODY_PRESERVING_REDIRECTS = new Set([307, 308]);
/** Same limit as `fetch`. */
const MAX_REDIRECTS = 20;
/** Same as `fetch`: credentials never follow a redirect to another origin. */
const CROSS_ORIGIN_DROPPED_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/** The encodings `fetch` decodes. A sync flush keeps a streamed reply arriving as it is sent. */
const DECODERS = new Map<string, () => Transform>([
  ['gzip', () => createGunzip({ flush: constants.Z_SYNC_FLUSH })],
  ['x-gzip', () => createGunzip({ flush: constants.Z_SYNC_FLUSH })],
  ['deflate', () => createInflate({ flush: constants.Z_SYNC_FLUSH })],
  ['br', () => createBrotliDecompress({ flush: constants.BROTLI_OPERATION_FLUSH })],
]);

export interface LongFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export function longFetch(url: string, init: LongFetchInit, redirects = 0): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = target.protocol === 'https:' ? https.request : http.request;
    const req = request(
      target,
      {
        method: init.method,
        headers: { 'Accept-Encoding': 'gzip, deflate, br', ...init.headers },
        signal: init.signal,
      },
      (res) => {
        const status = res.statusCode ?? 502;
        if (BODY_PRESERVING_REDIRECTS.has(status) && res.headers.location) {
          res.resume();
          const next = URL.parse(res.headers.location, target);
          if (!next) {
            reject(new Error(`Invalid redirect location from ${url}`));
          } else if (redirects >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects from ${url}`));
          } else if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            reject(new Error(`Refusing to follow a redirect to ${next.protocol}`));
          } else {
            const headers = next.origin === target.origin
              ? init.headers
              : Object.fromEntries(Object.entries(init.headers)
                  .filter(([name]) => !CROSS_ORIGIN_DROPPED_HEADERS.has(name.toLowerCase())));
            resolve(longFetch(next.href, { ...init, headers }, redirects + 1));
          }
          return;
        }
        if (status < 200 || status > 599) {
          res.resume();
          reject(new Error(`Unsupported HTTP status ${status} from ${url}`));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
        }
        if (NULL_BODY_STATUSES.has(status)) {
          res.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        const encoding = headers.get('content-encoding')?.trim().toLowerCase();
        const decoder = encoding ? DECODERS.get(encoding)?.() : undefined;
        if (decoder) {
          headers.delete('content-encoding');
          headers.delete('content-length');
        }
        // `pipeline` carries an abort or a corrupt body through to the reader.
        const body = decoder ? pipeline(res, decoder, () => {}) : res;
        resolve(new Response(Readable.toWeb(body) as ReadableStream, { status, headers }));
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });
}

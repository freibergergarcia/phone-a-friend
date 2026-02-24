/**
 * Web dashboard HTTP server.
 *
 * Serves static files from public/, REST API from /api/*, and SSE from /api/events.
 * Zero external dependencies — uses node:http only.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join, extname, resolve, relative, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TranscriptBus } from '../agentic/bus.js';
import { SSEBroadcaster } from './sse.js';
import { handleApiRoute } from './routes.js';

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Static file resolution
// ---------------------------------------------------------------------------

function resolvePublicDir(): string {
  // In dev: src/web/public/
  // In built dist: look relative to this file
  const thisDir = typeof __dirname !== 'undefined'
    ? __dirname
    : fileURLToPath(new URL('.', import.meta.url));

  // Try src/web/public first (dev mode)
  const devPath = join(thisDir, 'public');
  if (existsSync(devPath)) return devPath;

  // Fallback: relative to CWD
  const cwdPath = join(process.cwd(), 'src', 'web', 'public');
  if (existsSync(cwdPath)) return cwdPath;

  return devPath; // Will 404 gracefully
}

// ---------------------------------------------------------------------------
// Dashboard server
// ---------------------------------------------------------------------------

export interface DashboardOptions {
  port?: number;
  dbPath?: string;
  open?: boolean;
}

export interface DashboardServer {
  server: Server;
  sse: SSEBroadcaster;
  bus: TranscriptBus;
  url: string;
  close: () => Promise<void>;
}

export async function startDashboard(opts: DashboardOptions = {}): Promise<DashboardServer> {
  const port = opts.port ?? 7777;
  const bus = new TranscriptBus(opts.dbPath);
  const sse = new SSEBroadcaster();
  const publicDir = resolvePublicDir();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    // API routes
    if (path.startsWith('/api/')) {
      const handled = handleApiRoute(req, res, bus, sse);
      if (handled) return;
    }

    // Static file serving
    const filePath = path === '/'
      ? join(publicDir, 'index.html')
      : join(publicDir, path);

    // Prevent directory traversal (path-boundary safe)
    const resolved = resolve(filePath);
    const rel = relative(publicDir, resolved);
    if (rel.startsWith('..') || rel.startsWith(sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      const mime = MIME[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch {
      // SPA fallback: serve index.html for non-file paths
      if (!extname(path)) {
        try {
          const index = await readFile(join(publicDir, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(index);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const dashUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        sse,
        bus,
        url: dashUrl,
        close: async () => {
          sse.close();
          bus.close();
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}

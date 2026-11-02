import { spawn, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs the built CLI against a local server. Registration, Commander parsing,
// prompt building, session replay, longFetch and exit codes are all real. A
// preload sends api.x.ai to the local server and refuses any other HTTPS host.
describe('xai built CLI end to end', { timeout: 60_000 }, () => {
  interface Sent { authorization?: string; body: { tools?: { type: string }[]; input: { role: string; content: string }[] } }
  const entry = join(process.cwd(), 'dist', 'index.js');
  let root: string;
  let preload: string;
  let server: Server;
  let requests: Sent[];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paf-xai-e2e-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(root, 'tracked.txt'), 'one\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    writeFileSync(join(root, 'tracked.txt'), 'one\nDIRTY_LINE\n');
    requests = [];
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        requests.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'completed', error: null, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'stub answer', annotations: [{ type: 'url_citation', url: 'https://example.test/a' }] }] }] }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    preload = join(root, 'preload.mjs');
    writeFileSync(preload, `import http from 'node:http';
import https from 'node:https';
https.request = (url, options, callback) => {
  const target = new URL(url);
  if (target.hostname !== 'api.x.ai') throw new Error('unexpected host ' + target.hostname);
  return http.request('http://127.0.0.1:${(server.address() as AddressInfo).port}' + target.pathname, options, callback);
};
`);
  });

  afterEach(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  function paf(args: string[], key: string | null = 'fake-key'): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), PHONE_A_FRIEND_UPDATE_CHECK: 'false' };
    delete env.XAI_API_KEY;
    delete env.PHONE_A_FRIEND_DEPTH;
    if (key) env.XAI_API_KEY = key;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', preload, entry, '--to', 'xai', '--repo', root, '--timeout', '20', ...args], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
  }

  it('asks for a key, without calling xAI, when none is set', async () => {
    const result = await paf(['--no-include-diff', '--prompt', 'hello'], null);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Set XAI_API_KEY');
    expect(requests).toEqual([]);
  });

  it('searches on a plain relay and ends the answer with its sources', async () => {
    const result = await paf(['--no-include-diff', '--prompt', 'hello']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('stub answer\n\nSources:\n- https://example.test/a');
    expect(requests[0].authorization).toBe('Bearer fake-key');
    expect(requests[0].body.tools?.map(tool => tool.type)).toEqual(['web_search', 'x_search']);
  });

  it('sends a review with no search tools, and says so on stderr only', async () => {
    const result = await paf(['--review', '--review-scope', 'working-tree']);
    expect(result.code).toBe(0);
    expect(requests[0].body.input.at(-1)?.content).toContain('DIRTY_LINE');
    expect(requests[0].body.tools).toBeUndefined();
    expect(result.stderr).toContain('search are off');
    expect(result.stdout).not.toContain('search are off');
  });

  it.each([
    ['--context-text', ['--context-text', 'PRIVATE_NOTE']],
    ['--context-file', ['--context-file', 'NOTE_FILE']],
    ['a stream', ['--context-text', 'PRIVATE_NOTE', '--stream']],
    ['--quiet', ['--context-text', 'PRIVATE_NOTE', '--quiet']],
  ])('sends no search tools with attached context through %s', async (_name, extra) => {
    const notePath = join(root, 'note.txt');
    writeFileSync(notePath, 'PRIVATE_NOTE\n');
    const result = await paf(['--no-include-diff', '--prompt', 'hello', ...extra.map(arg => arg === 'NOTE_FILE' ? notePath : arg)]);
    expect(result.code).toBe(0);
    expect(requests[0].body.input.at(-1)?.content).toContain('PRIVATE_NOTE');
    expect(requests[0].body.tools).toBeUndefined();
  });

  it('keeps search off on a later session turn while the history holds a diff', async () => {
    expect((await paf(['--include-diff', '--session', 's', '--prompt', 'first'])).code).toBe(0);
    expect((await paf(['--no-include-diff', '--session', 's', '--prompt', 'second'])).code).toBe(0);
    expect(requests[1].body.input.map(turn => turn.role)).toEqual(['user', 'assistant', 'user']);
    expect(requests[1].body.input[0].content).toContain('DIRTY_LINE');
    expect(requests[1].body.tools).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CODEX_BACKEND } from '../../src/backends/codex.js';
import { relay } from '../../src/relay.js';
import { SessionStore } from '../../src/sessions.js';

// Real subprocess fixtures: no provider calls, authentication, or native Codex state.
describe('Codex schema subprocess contract', () => {
  let root: string;
  let bin: string;
  let log: string;
  const schema = JSON.stringify({
    type: 'object', properties: { status: { type: 'string', enum: ['ok'] } },
    required: ['status'], additionalProperties: false,
  });

  function installCli(mode: 'supported' | 'unsupported' | 'hanging' | 'noisy' | 'failed', dir = bin) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = ${JSON.stringify(log)};
const mode = ${JSON.stringify(mode)};
if (args.includes('--help')) {
  fs.appendFileSync(log, JSON.stringify({ help: true, mode, args }) + '\\n');
  if (mode === 'hanging') {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  } else if (mode === 'noisy') {
    process.stdout.write('x'.repeat(256 * 1024));
  } else if (mode === 'failed') {
    console.log('      --output-schema <FILE>');
    process.exitCode = 1;
  } else {
    console.log(mode === 'supported' ? '      --output-schema <FILE>' : '      --json');
  }
} else {
  const schemaIndex = args.indexOf('--output-schema');
  const schemaPath = schemaIndex < 0 ? null : args[schemaIndex + 1];
  const schema = schemaPath ? fs.readFileSync(schemaPath, 'utf8') : null;
  fs.appendFileSync(log, JSON.stringify({ help: false, mode, args, schemaPath, schema }) + '\\n');
  const outputIndex = args.indexOf('-o') < 0 ? args.indexOf('--output-last-message') : args.indexOf('-o');
  fs.writeFileSync(args[outputIndex + 1], '{"status":"ok"}');
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fixture-thread' }));
}
`, { mode: 0o755 });
  }

  function calls(): Array<{ help: boolean; mode: string; args: string[]; schemaPath: string | null; schema: string | null }> {
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-codex-schema-test-'));
    bin = join(root, 'bin');
    log = join(root, 'calls.jsonl');
    installCli('supported');
    vi.stubEnv('PATH', `${bin}:/usr/bin:/bin`);
    vi.stubEnv('PHONE_A_FRIEND_DEPTH', '0');
    vi.stubEnv('PHONE_A_FRIEND_HOST', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('forwards schema through initial, persisted resume, raw attachment, and adoption relay paths', async () => {
    const storePath = join(root, 'sessions.json');
    const opts = { backend: 'codex', prompt: 'Synthetic verdict', repoPath: root, schema, includeDiff: false };
    await expect(relay({ ...opts, session: 'review', sessionStore: new SessionStore(storePath) }))
      .resolves.toBe('{"status":"ok"}');
    expect(new SessionStore(storePath).get('review')?.backendSessionId).toBe('fixture-thread');
    await expect(relay({ ...opts, session: 'review', sessionStore: new SessionStore(storePath) }))
      .resolves.toBe('{"status":"ok"}');
    const persistedBeforeRaw = readFileSync(storePath, 'utf8');
    await expect(relay({ ...opts, backendSession: 'fixture-thread', sessionStore: new SessionStore(storePath) }))
      .resolves.toBe('{"status":"ok"}');
    expect(readFileSync(storePath, 'utf8')).toBe(persistedBeforeRaw);
    await expect(relay({ ...opts, backendSession: 'fixture-thread', session: 'adopted', sessionStore: new SessionStore(storePath) }))
      .resolves.toBe('{"status":"ok"}');
    expect(new SessionStore(storePath).get('adopted')?.backendSessionId).toBe('fixture-thread');

    const runs = calls().filter(call => !call.help);
    expect(runs).toHaveLength(4);
    expect(calls().filter(call => call.help)).toHaveLength(3);
    expect(runs[0].args).not.toContain('resume');
    for (const run of runs) {
      expect(run.schema).toBe(schema);
      expect(run.args).toContain('--json');
      expect(run.args).not.toContain('--ephemeral');
      expect(run.schemaPath).not.toBeNull();
      expect(existsSync(dirname(run.schemaPath!))).toBe(false);
    }
    for (const run of runs.slice(1)) expect(run.args.slice(0, 3)).toEqual(['exec', 'resume', 'fixture-thread']);
  });

  it('uses the per-call PATH for both help and execution instead of the host PATH', async () => {
    const alternate = join(root, 'alternate');
    installCli('unsupported', alternate);
    const opts = {
      prompt: 'Synthetic verdict', repoPath: root, schema, timeoutSeconds: 2,
      sandbox: 'read-only' as const, model: null, sessionId: 'fixture-thread', resumeSession: true,
    };
    await expect(CODEX_BACKEND.run({ ...opts, env: { PATH: `${alternate}:/usr/bin:/bin` } }))
      .rejects.toThrow(/does not advertise/);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].mode).toBe('unsupported');
    await expect(CODEX_BACKEND.run({ ...opts, env: { PATH: `${bin}:/usr/bin:/bin` } }))
      .resolves.toBe('{"status":"ok"}');
    expect(calls().map(call => [call.mode, call.help])).toEqual([
      ['unsupported', true], ['supported', true], ['supported', false],
    ]);
  });

  it.each(['hanging', 'noisy', 'failed'] as const)('bounds a %s help probe and never starts model work', async (mode) => {
    installCli(mode);
    await expect(CODEX_BACKEND.run({
      prompt: 'Synthetic verdict', repoPath: root, schema, timeoutSeconds: 3,
      sandbox: 'read-only', model: null, sessionId: 'fixture-thread', resumeSession: true,
      env: { PATH: `${bin}:/usr/bin:/bin` },
    })).rejects.toThrow(/Could not verify Codex resume schema support/);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].help).toBe(true);
  });
});

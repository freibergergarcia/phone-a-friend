import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

// Run the built product in separate processes. All external CLIs are fixtures;
// native SessionStore/SQLite, Commander parsing, events, and exit codes are real.
describe('M1 built CLI end to end', () => {
  let root: string;
  let bin: string;
  let log: string;
  let env: NodeJS.ProcessEnv;
  const entry = join(process.cwd(), 'dist', 'index.js');
  const schema = JSON.stringify({ type: 'object', properties: { result: { type: 'string', enum: ['ok'] } }, required: ['result'], additionalProperties: false });

  function fixture(name: string, directory = bin, version = '1.2.3', supportsSchema = true) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log(${JSON.stringify(version)}); process.exit(0); }
if (args.includes('--help')) {
 fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({name:${JSON.stringify(name)},help:true,args})+'\\n');
 console.log(${JSON.stringify(supportsSchema ? '      --output-schema <FILE>' : '      --json')}); process.exit(0);
}
const schemaIndex = args.indexOf('--output-schema');
const schemaPath = schemaIndex >= 0 ? args[schemaIndex+1] : null;
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({name:${JSON.stringify(name)},help:false,args,schema: schemaPath ? fs.readFileSync(schemaPath,'utf8') : null})+'\\n');
if (${JSON.stringify(name)} === 'claude') { console.log('@user: fixture review complete'); process.exit(0); }
const outIndex = args.indexOf('-o') >= 0 ? args.indexOf('-o') : args.indexOf('--output-last-message');
if (outIndex < 0) process.exit(3);
fs.writeFileSync(args[outIndex+1], '{"result":"ok"}');
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));
`, { mode: 0o755 });
  }

  /**
   * A stand-in for `pi --mode json`: prints the session header and one
   * answer, and keeps a session file in a flat `--session-dir` the way pi
   * 0.87.1 does, so a resume re-emits the original header.
   */
  function piFixture(version = '0.87.1') {
    writeFileSync(join(bin, 'pi'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log(${JSON.stringify(version)}); process.exit(0); }
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({name:'pi',help:false,args,schema:null})+'\\n');
const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : null; };
const dir = at('--session-dir'); const id = at('--session-id');
let header = { type: 'session', version: 3, id: id || 'ephemeral', timestamp: new Date().toISOString(), cwd: process.cwd() };
let turn = 1;
if (dir && id) {
  const file = path.join(dir, 'fixture_' + id + '.jsonl');
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\\n');
    header = JSON.parse(lines[0]); turn = lines.length;
  } else fs.writeFileSync(file, JSON.stringify(header) + '\\n');
  fs.appendFileSync(file, JSON.stringify({ type: 'message', turn }) + '\\n');
}
const text = 'pi fixture turn ' + turn;
for (const record of [
  header,
  { type: 'message_start', message: { role: 'assistant', content: [], stopReason: 'pending' } },
  { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } },
  { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } },
]) console.log(JSON.stringify(record));
`, { mode: 0o755 });
  }

  function run(args: string[]) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 15_000, killSignal: 'SIGKILL',
    });
    expect(result.error, result.stderr).toBeUndefined();
    return result;
  }

  function calls(): Array<{ name: string; help: boolean; args: string[]; schema: string | null }> {
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-m1-cli-e2e-'));
    bin = join(root, 'bin'); log = join(root, 'calls.jsonl');
    mkdirSync(bin);
    // No inherited authentication/configuration. The invalid Ollama URL disables
    // its unrelated health check without contacting any real service.
    env = {
      PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
      HOME: root, XDG_CONFIG_HOME: join(root, 'config'), CODEX_HOME: join(root, 'codex'),
      CLAUDE_CONFIG_DIR: join(root, 'claude'), PHONE_A_FRIEND_UPDATE_CHECK: 'false',
      PHONE_A_FRIEND_DEPTH: '0', CI: 'true', TERM: 'dumb', OLLAMA_HOST: 'disabled://ollama',
    };
    for (const name of ['codex', 'claude', 'gemini', 'opencode', 'agy', 'pi']) fixture(name);
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('starts, resumes, attaches and adopts a schema-bearing Codex thread across CLI processes', () => {
    const args = ['--to', 'codex', '--repo', root, '--prompt', 'Synthetic check', '--schema', schema, '--no-include-diff'];
    for (const session of [
      ['--session', 'review'], ['--session', 'review'],
      ['--backend-session', 'fixture-thread'], ['--backend-session', 'fixture-thread', '--session', 'adopted'],
    ]) {
      const result = run([...args, ...session]);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ result: 'ok' });
    }
    const executed = calls().filter(c => !c.help);
    expect(executed).toHaveLength(4);
    expect(executed.every(c => c.schema === schema)).toBe(true);
    expect(executed[0].args).not.toContain('resume');
    for (const c of executed.slice(1)) expect(c.args.slice(0, 3)).toEqual(['exec', 'resume', 'fixture-thread']);
    const listed = JSON.parse(run(['session', 'list', '--json']).stdout);
    expect(listed.map((s: { id: string }) => s.id).sort()).toEqual(['adopted', 'review']);
    expect(listed.every((s: { backendSessionId: string }) => s.backendSessionId === 'fixture-thread')).toBe(true);
  });

  it('returns failure for unsupported resume schemas before backend execution', () => {
    fixture('codex', bin, '0.1.0', false);
    const result = run(['--to', 'codex', '--repo', root, '--prompt', 'Synthetic check', '--schema', schema, '--backend-session', 'fixture-thread']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not advertise --output-schema');
    expect(calls()).toHaveLength(1);
    expect(calls()[0].help).toBe(true);
  });

  describe('pi', () => {
    const piArgs = () => calls().filter(c => c.name === 'pi').map(c => c.args);
    const valueOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
    const relayArgs = ['--to', 'pi', '--repo', '.', '--prompt', 'Synthetic check', '--no-include-diff'];
    let piSessions: string;

    beforeEach(() => {
      piFixture();
      piSessions = join(root, 'config', 'phone-a-friend', 'pi-sessions');
    });

    it('relays one-shot, streamed and batch, read-only and without leaving a session', () => {
      for (const extra of [[], ['--no-stream']]) {
        const result = run([...relayArgs, ...extra]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe('pi fixture turn 1');
      }
      const executed = piArgs();
      expect(executed).toHaveLength(2);
      for (const args of executed) {
        expect(args.slice(0, 4)).toEqual(['--mode', 'json', '--no-approve', '--no-session']);
        expect(args).toContain('-ne');
        expect(valueOf(args, '--tools')).toBe('read,grep,find,ls');
        expect(args).not.toContain('--session-id');
        expect(args.slice(-2)[0]).toBe('--');
      }
      expect(existsSync(piSessions)).toBe(false);
    });

    it('starts and resumes a session across CLI processes, and refuses a resume whose session file is gone', () => {
      const first = run([...relayArgs, '--session', 'local']);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout.trim()).toBe('pi fixture turn 1');
      const second = run([...relayArgs, '--session', 'local']);
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout.trim()).toBe('pi fixture turn 2');

      const executed = piArgs();
      expect(executed).toHaveLength(2);
      const id = valueOf(executed[0], '--session-id');
      expect(valueOf(executed[1], '--session-id')).toBe(id);
      for (const args of executed) {
        expect(realpathSync(valueOf(args, '--session-dir'))).toBe(realpathSync(piSessions));
        expect(args).not.toContain('--no-session');
      }
      expect(readdirSync(piSessions)).toEqual([`fixture_${id}.jsonl`]);
      const listed = JSON.parse(run(['session', 'list', '--json']).stdout);
      expect(listed.map((s: { id: string; backend: string; backendSessionId: string }) => [s.id, s.backend, s.backendSessionId]))
        .toEqual([['local', 'pi', id]]);

      // pi would silently create a new session here; PaF must stop first.
      renameSync(join(piSessions, `fixture_${id}.jsonl`), join(root, 'moved-away.jsonl'));
      const third = run([...relayArgs, '--session', 'local']);
      expect(third.status).toBe(1);
      expect(third.stderr).toContain(`pi session ${id} not found`);
      expect(third.stderr).toContain('cannot be attached');
      expect(piArgs()).toHaveLength(2);
      expect(readdirSync(piSessions)).toEqual([]);
    });

    it('maps the sandbox to the tool list, --fast to -nc -ns, and passes provider and model from config', () => {
      const config = join(root, 'config', 'phone-a-friend'); mkdirSync(config, { recursive: true });
      writeFileSync(join(config, 'config.toml'), '[backends.pi]\nprovider = "mlx"\nmodel = "fixture/model"\n');
      const result = run([...relayArgs, '--sandbox', 'workspace-write', '--fast', '--no-stream']);
      expect(result.status, result.stderr).toBe(0);
      const [args] = piArgs();
      expect(valueOf(args, '--tools')).toBe('read,grep,find,ls,edit,write');
      expect(valueOf(args, '--provider')).toBe('mlx');
      expect(valueOf(args, '--model')).toBe('fixture/model');
      expect(args).toEqual(expect.arrayContaining(['-nc', '-ns']));
    });

    it('refuses to call pi from inside pi, and refuses a pi older than the minimum, without spawning', () => {
      env.PI_CODING_AGENT = 'true';
      const nested = run(relayArgs);
      expect(nested.status).toBe(1);
      expect(nested.stderr).toContain('pi is already the host');
      delete env.PI_CODING_AGENT;

      piFixture('0.78.4');
      const old = run(relayArgs);
      expect(old.status).toBe(1);
      expect(old.stderr).toContain('pi 0.78.4 is too old');
      expect(piArgs()).toEqual([]);
    });
  });

  it.each(['codex', 'gemini', 'opencode', 'pi'])('rejects agentic %s without substitution and records failure', (backend) => {
    const result = run(['agentic', 'run', '--agents', `reviewer:${backend}`, '--prompt', 'Synthetic check', '--repo', root, '--max-turns', '1']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Backend "${backend}" is not yet supported`);
    expect(result.stdout).toContain('Session ended: error');
    expect(calls()).toEqual([]);
    const sessionId = /Agentic Session (\S+)/.exec(result.stdout)![1];
    const logs = run(['agentic', 'logs', '--session', sessionId]);
    expect(logs.status, logs.stderr).toBe(0);
    expect(logs.stdout).toContain('failed');
  });

  it('returns failure for a partially failed run while retaining the successful answer', () => {
    const result = run(['agentic', 'run', '--agents', 'reviewer:claude,critic:codex', '--prompt', 'Synthetic check', '--repo', root, '--max-turns', '1']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('fixture review complete');
    expect(result.stderr).toContain('Backend "codex" is not yet supported');
    expect(calls().map(c => c.name)).toEqual(['claude']);
  });

  it('runs the supported Claude agentic adapter and makes the transcript readable', () => {
    const result = run(['agentic', 'run', '--agents', 'reviewer:claude', '--prompt', 'Synthetic check', '--repo', root, '--max-turns', '1']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('fixture review complete');
    expect(calls().map(c => c.name)).toEqual(['claude']);
    const sessionId = /Agentic Session (\S+)/.exec(result.stdout)![1];
    const logs = run(['agentic', 'logs', '--session', sessionId]);
    expect(logs.status, logs.stderr).toBe(0);
    expect(logs.stdout).toContain('fixture review complete');
    expect(logs.stdout).toContain('completed');
  });

  it('exposes selected versions and configured Claude model through doctor JSON and text', () => {
    const alternate = join(root, 'alternate');
    fixture('codex', bin, '0.146.0'); fixture('codex', alternate, '0.153.4');
    env.PATH = [bin, alternate, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter);
    const config = join(root, 'config', 'phone-a-friend'); mkdirSync(config, { recursive: true });
    writeFileSync(join(config, 'config.toml'), '[backends.claude]\nmodel = "fixture-claude"\n\n[backends.pi]\nprovider = "mlx"\n');
    const json = run(['doctor', '--json']);
    // Ollama is outside this suite; inspect CLI-backend facts independently of readiness exit status.
    const report = JSON.parse(json.stdout);
    const codex = report.backends.cli.find((b: { name: string }) => b.name === 'codex');
    expect(codex.executable.selected.path).toBe(join(bin, 'codex'));
    expect(codex.executable.selected.version).toBe('0.146.0');
    expect(codex.executable.versionMismatch).toBe(true);
    expect(report.host.find((b: { name: string }) => b.name === 'claude').model.requested).toBe('fixture-claude');
    const pi = report.backends.cli.find((b: { name: string }) => b.name === 'pi');
    expect(pi.executable.selected.path).toBe(join(bin, 'pi'));
    expect(pi.executable.selected.version).toBe('1.2.3');
    expect(pi.model.provider).toEqual({ requested: 'mlx', requestedSource: 'paf-config' });
    expect(pi.capabilities.declared.resumeStrategy).toBe('native-session');
    const human = run(['doctor']);
    expect(human.stdout).toContain('requested=fixture-claude');
    expect(human.stdout).toContain('provider: mlx (from PaF config)');
    expect(human.stdout).toContain('[versions differ]');
    // Existing doctor also enumerates OpenCode model metadata; it never requests inference.
    expect(calls().map(c => [c.name, c.args])).toEqual([['opencode', ['models']], ['opencode', ['models']]]);
  });
});

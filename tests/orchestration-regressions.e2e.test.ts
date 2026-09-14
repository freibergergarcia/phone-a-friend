import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const repo = process.cwd();
let bundleDir: string;
let root: string;
let env: NodeJS.ProcessEnv;
beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), 'paf-orchestration-bundle-'));
  await build({
    stdin: {
      contents: `
      import { SessionStore } from './src/sessions.js';
      import { Orchestrator } from './src/agentic/orchestrator.js';
      import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
      const [mode, path, id, label = id] = process.argv.slice(2);
      if (mode === 'write') {
        writeFileSync(path + '.' + id + '.ready', 'ready');
        while (!existsSync(path + '.go')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        const s = new SessionStore(path);
        for (let i = 0; i < 20; i++) s.upsert({id:label,backend:'ollama',repoPath:'/repo',historyAppend:[{role:'user',content:String(i)}]});
      } else if (mode === 'list') console.log(JSON.stringify(new SessionStore(path).list()));
      else {
        const o = new Orchestrator(path);
        o.onEvent(e => {
          let workerAlive = false;
          if (e.type === 'session_end') {
            try { process.kill(Number(readFileSync(process.cwd() + '/worker', 'utf8')), 0); workerAlive = true; } catch {}
          }
          appendFileSync(path + '.events', JSON.stringify({...e, workerAlive}) + '\\n');
        });
        const stream = await o.run({agents:[{name:'a',backend:'claude'}],prompt:'probe',maxTurns:2,timeoutSeconds:10,repoPath:process.cwd(),sandbox:'read-only'});
        const deadline = Date.now() + 2000;
        while (!existsSync(process.cwd() + '/worker') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
        o.stop();
        for await (const e of stream) {}
        await o.close();
      }
    `,
      resolveDir: repo,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['better-sqlite3'],
    banner: {
      js: `import {createRequire} from 'node:module'; const require = createRequire(${JSON.stringify(join(repo, 'package.json'))});`,
    },
    outfile: join(bundleDir, 'probe.mjs'),
  });
});
afterAll(() => rmSync(bundleDir, { recursive: true, force: true }));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paf-orchestration-regression-'));
  mkdirSync(join(root, 'bin'));
  env = {
    ...process.env,
    PATH: [
      join(root, 'bin'),
      dirname(process.execPath),
      '/usr/bin',
      '/bin',
    ].join(':'),
    HOME: root,
    XDG_CONFIG_HOME: join(root, 'config'),
    PHONE_A_FRIEND_UPDATE_CHECK: 'false',
    PHONE_A_FRIEND_DEPTH: '0',
    CI: 'true',
    TERM: 'dumb',
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function fixture(body: string) {
  writeFileSync(
    join(root, 'bin', 'claude'),
    `#!${process.execPath}\n${body}\n`,
    { mode: 0o755 },
  );
}
function run(args: string[], cli = true) {
  const child = spawn(
    process.execPath,
    [cli ? join(repo, 'dist/index.js') : join(bundleDir, 'probe.mjs'), ...args],
    { cwd: root, env },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (c) => {
    stdout += c;
  });
  child.stderr.on('data', (c) => {
    stderr += c;
  });
  const done = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) =>
    child.on('close', (code) => resolve({ code, stdout, stderr })),
  );
  return { child, done };
}
function agentArgs(...extra: string[]) {
  return [
    'agentic',
    'run',
    '--agents',
    'reviewer:claude',
    '--prompt',
    'probe',
    '--repo',
    root,
    '--max-turns',
    '2',
    ...extra,
  ];
}
function session() {
  const db = new Database(join(root, 'config/phone-a-friend/agentic.db'));
  try {
    return db.prepare('SELECT * FROM sessions').get() as {
      status: string;
      end_reason: string;
    };
  } finally {
    db.close();
  }
}
async function waitFile(path: string) {
  for (let n = 0; n < 500; n++) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('fixture did not become ready');
}
it('preserves partial output while reporting a nonzero child as failed', async () => {
  fixture("console.log('partial finding'); process.exit(7);");
  const result = await run(agentArgs()).done;
  expect(result.code).toBe(1);
  expect(result.stdout).toContain('partial finding');
  expect(result.stderr).toContain('7');
  expect(session().status).toBe('failed');
});
it('enforces deadline, kills a TERM-resistant descendant, and persists timeout as failure', async () => {
  const pidPath = join(root, 'descendant');
  fixture(`const {spawn}=require('node:child_process'); const fs=require('node:fs');
    process.on('SIGTERM',()=>{});
    const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(pidPath)},String(c.pid));console.log('partial before timeout');setInterval(()=>{},1000);`);
  const started = Date.now();
  const { child, done } = run(agentArgs('--timeout', '3'));
  await waitFile(pidPath);
  const pid = Number(readFileSync(pidPath, 'utf8'));
  const watchdog = setTimeout(() => {
    child.kill('SIGKILL');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }, 7000);
  try {
    const result = await done;
    expect(Date.now() - started).toBeLessThan(5500);
    expect(result.code).toBe(1);
    expect(session()).toMatchObject({
      status: 'failed',
      end_reason: 'timeout',
    });
    expect(result.stdout).toContain('partial before timeout');
    // kill(0) can see a reparented zombie on Linux; ps distinguishes it from a live worker.
    let state = '';
    try {
      state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
    } catch {}
    expect(state === '' || state.startsWith('Z')).toBe(true);
  } finally {
    clearTimeout(watchdog);
    child.kill('SIGKILL');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}, 10000);
it('stop waits for child termination before closing its event stream', async () => {
  const pidPath = join(root, 'worker');
  fixture(
    `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
  );
  const { child, done } = run(['stop', join(root, 'agentic.db')], false);
  await waitFile(pidPath);
  const pid = Number(readFileSync(pidPath, 'utf8'));
  const watchdog = setTimeout(() => {
    child.kill('SIGKILL');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }, 3000);
  try {
    const result = await done;
    expect(result.code).toBe(0);
    expect(() => process.kill(pid, 0)).toThrow();
    const events = readFileSync(join(root, 'agentic.db.events'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.find((e) => e.type === 'session_end')).toMatchObject({
      reason: 'stopped',
      workerAlive: false,
    });
  } finally {
    clearTimeout(watchdog);
    child.kill('SIGKILL');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}, 6000);
it.each(['read-only', 'workspace-write', 'danger-full-access'])(
  'passes %s tool policy on both initial and resumed calls',
  async (sandbox) => {
    const log = join(root, 'args');
    fixture(`const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
    if(a.includes('-r'))console.log('@user: done');else {const name=/You are "([^"]+)"/.exec(a[1])[1];console.log('@'+name+': follow up');}`);
    const result = await run(
      agentArgs('--sandbox', sandbox, '--agents', 'reviewer:claude:haiku'),
    ).done;
    expect(result.code).toBe(0);
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((x) => JSON.parse(x) as string[]);
    expect(calls).toHaveLength(2);
    for (const args of calls) {
      if (sandbox === 'danger-full-access')
        expect(args).toContain('--dangerously-skip-permissions');
      else {
        const tools = args[args.indexOf('--tools') + 1];
        expect(tools.includes('Write')).toBe(sandbox === 'workspace-write');
      }
      expect(args).toContain('--disable-slash-commands');
      expect(args[args.indexOf('--model') + 1]).toBe('haiku');
      expect(args[args.indexOf('--disallowedTools') + 1]).toBe('Task');
    }
  },
);
it('preserves every label and history append from concurrent processes', async () => {
  const file = join(root, 'sessions.json');
  writeFileSync(file, '[]');
  const workers = Array.from({ length: 8 }, (_, i) =>
    run(['write', file, String(i)], false),
  );
  await Promise.all(workers.map((_, i) => waitFile(file + '.' + i + '.ready')));
  writeFileSync(file + '.go', 'go');
  const results = await Promise.all(workers.map((w) => w.done));
  expect(results.every((r) => r.code === 0)).toBe(true);
  const result = await run(['list', file], false).done;
  const rows = JSON.parse(result.stdout);
  expect(rows).toHaveLength(8);
  expect(
    rows.every((r: { history: unknown[] }) => r.history.length === 20),
  ).toBe(true);
}, 10000);

it('fails at the turn cap when work remains, and persists the reason', async () => {
  const namePath = join(root, 'name');
  fixture(`const fs=require('node:fs');const args=process.argv.slice(2);
    if(!args.includes('-r'))fs.writeFileSync(${JSON.stringify(namePath)},/You are "([^"]+)"/.exec(args[1])[1]);
    console.log('@'+fs.readFileSync(${JSON.stringify(namePath)},'utf8')+': more work');`);
  const result = await run(agentArgs('--max-turns', '1')).done;
  expect(result.code).toBe(1);
  expect(session()).toMatchObject({
    status: 'failed',
    end_reason: 'max_turns',
  });
});

it('completes successfully when the final allowed turn finishes the work', async () => {
  fixture(`const args=process.argv.slice(2);
    console.log(args.includes('-r') ? '@user: done' : '@'+/You are "([^"]+)"/.exec(args[1])[1]+': follow up');`);
  const result = await run(agentArgs('--max-turns', '1')).done;
  expect(result.code).toBe(0);
  expect(session()).toMatchObject({
    status: 'completed',
    end_reason: 'converged',
  });
});

it('preserves simultaneous appends to the same session label', async () => {
  const file = join(root, 'sessions.json');
  const workers = Array.from({ length: 4 }, (_, i) =>
    run(['write', file, String(i), 'shared'], false),
  );
  await Promise.all(workers.map((_, i) => waitFile(file + '.' + i + '.ready')));
  writeFileSync(file + '.go', 'go');
  const results = await Promise.all(workers.map((worker) => worker.done));
  expect(results.every((result) => result.code === 0)).toBe(true);
  const result = await run(['list', file], false).done;
  const rows = JSON.parse(result.stdout);
  expect(rows).toHaveLength(1);
  expect(rows[0].history).toHaveLength(80);
}, 10000);

it.each(['SIGINT', 'SIGTERM'] as const)(
  'handles CLI %s by stopping its worker',
  async (signal) => {
    const pidPath = join(root, 'worker');
    fixture(
      `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
    );
    const { child, done } = run(agentArgs());
    await waitFile(pidPath);
    const pid = Number(readFileSync(pidPath, 'utf8'));
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }, 3000);
    try {
      child.kill(signal);
      const result = await done;
      expect(result.code).toBe(1);
      expect(session()).toMatchObject({
        status: 'stopped',
        end_reason: 'stopped',
      });
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      clearTimeout(watchdog);
      child.kill('SIGKILL');
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  },
  6000,
);

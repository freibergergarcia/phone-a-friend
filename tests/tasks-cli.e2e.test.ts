import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../src/tasks.js';

// Runs the built CLI in separate processes against a fixture codex. Git,
// SQLite task records, Commander parsing, stderr contracts, and exit codes are real.
describe('task tracking built CLI end to end', () => {
  let root: string;
  let repo: string;
  let bin: string;
  let log: string;
  let env: NodeJS.ProcessEnv;
  const entry = join(process.cwd(), 'dist', 'index.js');

  function fixtureCodex(opts: { exitCode?: number; touchDuringRun?: string } = {}) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9'); process.exit(0); }
if (args.includes('--help')) { console.log('      --output-schema <FILE>'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args }) + '\\n');
const outIndex = args.indexOf('-o') >= 0 ? args.indexOf('-o') : args.indexOf('--output-last-message');
const json = args.includes('--json');
const emit = (o) => { if (json) process.stdout.write(JSON.stringify(o) + '\\n'); };
emit({ type: 'thread.started', thread_id: 'fixture-thread' });
emit({ type: 'turn.started' });
emit({ type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'git diff', aggregated_output: '', exit_code: null, status: 'in_progress' } });
${opts.touchDuringRun ? `fs.appendFileSync(${JSON.stringify(opts.touchDuringRun)}, 'edited during review\\n');` : ''}
emit({ type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'git diff', aggregated_output: 'x', exit_code: 0, status: 'completed' } });
emit({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Fixture review: one finding.' } });
emit({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } });
if (${opts.exitCode ?? 0} !== 0) { process.stderr.write('fixture codex exploded\\n'); process.exit(${opts.exitCode ?? 0}); }
if (outIndex >= 0) fs.writeFileSync(args[outIndex + 1], 'Fixture review: one finding.');
`, { mode: 0o755 });
  }

  function git(...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  }

  function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: repo, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL',
    });
    expect(result.error, result.stderr).toBeUndefined();
    return result;
  }

  function taskId(stderr: string): string {
    const match = /Task ([0-9a-f]{8}) started/.exec(stderr);
    expect(match, stderr).not.toBeNull();
    return match![1];
  }

  function calls(): Array<{ args: string[] }> {
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-tasks-e2e-'));
    repo = join(root, 'repo');
    bin = join(root, 'bin');
    log = join(root, 'calls.jsonl');
    mkdirSync(repo);
    env = {
      PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
      HOME: root, XDG_CONFIG_HOME: join(root, 'config'), CODEX_HOME: join(root, 'codex'),
      CLAUDE_CONFIG_DIR: join(root, 'claude'), PHONE_A_FRIEND_UPDATE_CHECK: 'false',
      PHONE_A_FRIEND_DEPTH: '0', CI: 'true', TERM: 'dumb', OLLAMA_HOST: 'disabled://ollama',
    };
    fixtureCodex();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(join(repo, 'auth.ts'), 'export const expiry = 1;\n');
    git('add', 'auth.ts');
    git('commit', '-q', '-m', 'init');
    writeFileSync(join(repo, 'auth.ts'), 'export const expiry = 2;\n');
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('records a native Codex review as a findable task with scope, session, events, and result', () => {
    const result = run(['--to', 'codex', '--repo', repo, '--review', '--review-scope', 'working-tree']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Fixture review: one finding.');
    const id = taskId(result.stderr);
    expect(result.stderr).toContain(`Task ${id} completed`);
    expect(calls()[0].args).toContain('--json');

    const listed = JSON.parse(run(['task', 'list', '--json']).stdout);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id, kind: 'review', status: 'completed', backend: 'codex', reviewScope: 'working-tree',
      repoPath: git('rev-parse', '--show-toplevel'), branch: 'main', headSha: git('rev-parse', 'HEAD'),
      diffFiles: 1, driftDetected: false, backendSessionId: 'fixture-thread', host: null,
      result: 'Fixture review: one finding.',
    });
    expect(listed[0].diffHash).toMatch(/^[0-9a-f]{64}$/);

    const shown = JSON.parse(run(['task', 'show', id, '--json']).stdout);
    expect(shown.task.id).toBe(id);
    expect(shown.events.map((e: { type: string }) => e.type)).toEqual([
      'started', 'scope_captured', 'session_linked', 'turn_started', 'activity', 'activity', 'message', 'turn_completed', 'scope_verified', 'completed',
    ]);

    const human = run(['task', 'show', id.slice(0, 5)]);
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain('working-tree');
    expect(human.stdout).toContain('fixture-thread');
    expect(human.stdout).toContain('Running: git diff');

    const stored = run(['task', 'result', id]);
    expect(stored.status).toBe(0);
    expect(stored.stdout.trim()).toBe('Fixture review: one finding.');
  });

  it('flags drift when the working tree changes during the review', () => {
    fixtureCodex({ touchDuringRun: join(repo, 'auth.ts') });
    const result = run(['--to', 'codex', '--repo', repo, '--review', '--review-scope', 'working-tree']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/changed during the review/i);
    const [task] = JSON.parse(run(['task', 'list', '--json']).stdout);
    expect(task.driftDetected).toBe(true);
    const shown = JSON.parse(run(['task', 'show', task.id, '--json']).stdout);
    expect(shown.events.map((e: { type: string }) => e.type)).toContain('drift_detected');
  });

  it('tracks a plain relay and honors metadata and off modes', () => {
    const tracked = run(['--to', 'codex', '--repo', repo, '--prompt', 'Explain auth.ts', '--no-include-diff', '--no-stream']);
    expect(tracked.status, tracked.stderr).toBe(0);
    const id = taskId(tracked.stderr);

    const metadata = run(['--to', 'codex', '--repo', repo, '--prompt', 'Secret prompt', '--no-include-diff', '--no-stream'], { PHONE_A_FRIEND_TASK_HISTORY: 'metadata' });
    expect(metadata.status, metadata.stderr).toBe(0);
    const metadataId = taskId(metadata.stderr);

    const off = run(['--to', 'codex', '--repo', repo, '--prompt', 'Untracked', '--no-include-diff', '--no-stream', '--no-task-history']);
    expect(off.status, off.stderr).toBe(0);
    expect(off.stderr).not.toMatch(/Task [0-9a-f]{8} started/);

    const listed = JSON.parse(run(['task', 'list', '--json']).stdout);
    expect(listed.map((t: { id: string }) => t.id)).toEqual([metadataId, id]);
    const [meta, full] = listed;
    expect(full).toMatchObject({ kind: 'relay', status: 'completed', promptPreview: 'Explain auth.ts', result: 'Fixture review: one finding.' });
    expect(meta).toMatchObject({ kind: 'relay', status: 'completed', promptPreview: null, result: null });
    expect(meta.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a failed backend run and reports it through task result', () => {
    fixtureCodex({ exitCode: 1 });
    const result = run(['--to', 'codex', '--repo', repo, '--prompt', 'Boom', '--no-include-diff', '--no-stream']);
    expect(result.status).toBe(1);
    const id = taskId(result.stderr);
    const [task] = JSON.parse(run(['task', 'list', '--json']).stdout);
    expect(task).toMatchObject({ id, status: 'failed' });
    expect(task.error).toContain('fixture codex exploded');
    const stored = run(['task', 'result', id]);
    expect(stored.status).toBe(1);
    expect(stored.stderr).toContain('fixture codex exploded');
  });

  it('marks tasks whose owner process is gone as interrupted and filters, deletes, and prunes', () => {
    const store = new TaskStore(join(root, 'config', 'phone-a-friend', 'tasks.db'));
    const repoRoot = git('rev-parse', '--show-toplevel');
    const orphan = store.create({ kind: 'review', backend: 'codex', repoPath: repoRoot });
    store.start(orphan.id, 2147483646);
    const elsewhere = store.create({ kind: 'relay', backend: 'claude', repoPath: '/elsewhere' });
    store.close();

    const listed = JSON.parse(run(['task', 'list', '--json']).stdout);
    expect(listed.find((t: { id: string }) => t.id === orphan.id).status).toBe('interrupted');
    const pending = run(['task', 'result', orphan.id]);
    expect(pending.status).toBe(1);
    expect(pending.stderr).toMatch(/interrupted/i);

    const filtered = JSON.parse(run(['task', 'list', '--json', '--repo', repo]).stdout);
    expect(filtered.map((t: { id: string }) => t.id)).toEqual([orphan.id]);

    const removed = run(['task', 'delete', elsewhere.id]);
    expect(removed.status, removed.stderr).toBe(0);
    expect(JSON.parse(run(['task', 'list', '--json']).stdout)).toHaveLength(1);

    const pruned = run(['task', 'prune', '--all']);
    expect(pruned.status, pruned.stderr).toBe(0);
    expect(JSON.parse(run(['task', 'list', '--json']).stdout)).toEqual([]);
  });

  it('prints progress lines and a receipt on stderr for a review', () => {
    const result = run(['--to', 'codex', '--repo', repo, '--review', '--review-scope', 'working-tree']);
    expect(result.status, result.stderr).toBe(0);
    const id = taskId(result.stderr);
    expect(result.stderr).toMatch(/◇ scope: 1 file\(s\) · \d+ bytes \(working-tree against main\)/);
    expect(result.stderr).toContain('◇ session: fixture-thread');
    expect(result.stderr).toMatch(/◇ \d\d:\d\d Running: git diff/);
    expect(result.stderr).toMatch(new RegExp(`◇ Task ${id} completed · \\d+s · scope unchanged`));
  });

  it('renders a status line row for the repo from the Claude status line JSON', () => {
    const store = new TaskStore(join(root, 'config', 'phone-a-friend', 'tasks.db'));
    const repoRoot = git('rev-parse', '--show-toplevel');
    const live = store.create({ kind: 'review', backend: 'codex', repoPath: repoRoot, reviewScope: 'working-tree' });
    store.start(live.id, process.pid);
    store.addEvent(live.id, 'activity', 'Running: git diff');
    store.close();

    const statusLine = (cwd: string) => spawnSync(process.execPath, [entry, 'task', 'status-line'], {
      cwd: repo, env, encoding: 'utf8', input: JSON.stringify({ cwd, session_id: 's1' }), timeout: 20_000, killSignal: 'SIGKILL',
    });
    const active = statusLine(repo);
    expect(active.status, active.stderr).toBe(0);
    expect(active.stdout.trim()).toMatch(new RegExp(`^◇ PaF codex review ${live.id} · \\d\\d:\\d\\d · Running: git diff$`));
    const idle = statusLine('/nowhere/else');
    expect(idle.status, idle.stderr).toBe(0);
    expect(idle.stdout).toBe('');
  });

  it('reports a running task through task result with a distinct exit code', () => {
    const store = new TaskStore(join(root, 'config', 'phone-a-friend', 'tasks.db'));
    const live = store.create({ kind: 'review', backend: 'codex', repoPath: repo });
    store.start(live.id, process.pid);
    store.close();
    const result = run(['task', 'result', live.id]);
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/running/i);
  });
});

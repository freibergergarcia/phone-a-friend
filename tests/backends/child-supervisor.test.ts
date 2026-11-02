/**
 * Real processes, no fakes: the behaviour under test is what the operating
 * system does with signals, process groups and pipes. Each child's tool process
 * sleeps for a unique, short duration: survivors can be found and removed, and
 * one that cleanup misses (a sandbox can block pgrep) soon exits by itself.
 */
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_TIMEOUT_SECONDS,
  ownProcessGroup,
  superviseChild,
  timeoutProblem,
} from '../../src/backends/child-supervisor.js';

const posix = process.platform !== 'win32';
const SLEEP = '41.337';

function survivors(): string[] {
  const { stdout } = spawnSync('pgrep', ['-f', `sleep ${SLEEP.replace('.', '[.]')}`], { encoding: 'utf8' });
  return stdout.split('\n').filter(Boolean);
}

function removeSurvivors(): void {
  for (const pid of survivors()) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
  }
}

function runShell(script: string) {
  return spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'], ...ownProcessGroup() });
}

async function settleTime(promise: Promise<unknown>): Promise<number> {
  const start = Date.now();
  await promise;
  return Date.now() - start;
}

describe('timeoutProblem', () => {
  it('accepts 0 (no limit), an ordinary value, and the largest timer value', () => {
    expect(timeoutProblem(0)).toBeNull();
    expect(timeoutProblem(600)).toBeNull();
    expect(timeoutProblem(MAX_TIMEOUT_SECONDS)).toBeNull();
  });

  it('rejects values a timer cannot hold, which would otherwise fire at once', () => {
    expect(timeoutProblem(MAX_TIMEOUT_SECONDS + 1)).toContain('at most');
    expect(timeoutProblem(-1)).toContain('0 for no limit');
    expect(timeoutProblem(Number.NaN)).toContain('0 for no limit');
    expect(timeoutProblem(Number.POSITIVE_INFINITY)).toContain('0 for no limit');
  });
});

describe.runIf(posix)('superviseChild', { timeout: 15_000 }, () => {
  afterEach(removeSurvivors);

  it('reports a normal exit with no limit set', async () => {
    const child = runShell('sleep 0.2; exit 7');
    const supervisor = superviseChild(child, { timeoutMs: 0 });
    const result = await supervisor.exit;
    expect(result).toEqual({ code: 7, signal: null, spawnError: null });
    expect(supervisor.timedOut).toBe(false);
  });

  it('does not fire a limit of 0, even after the moment a 0ms timer would', async () => {
    const child = runShell('sleep 0.5; echo done');
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    const supervisor = superviseChild(child, { timeoutMs: 0 });
    const result = await supervisor.exit;
    expect(result.code).toBe(0);
    expect(out.trim()).toBe('done');
  });

  it('kills a child that ignores SIGTERM shortly after the limit', async () => {
    const child = runShell(`trap '' TERM; while true; do sleep 1; done`);
    const supervisor = superviseChild(child, { timeoutMs: 200, killGraceMs: 300 });
    const elapsed = await settleTime(supervisor.exit);
    expect(supervisor.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
    expect((await supervisor.exit).signal).toBe('SIGKILL');
  });

  it('kills tool children too, not only the backend', async () => {
    const child = runShell(`sleep ${SLEEP} & wait`);
    const supervisor = superviseChild(child, { timeoutMs: 200, killGraceMs: 300 });
    await supervisor.exit;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(survivors()).toEqual([]);
  });

  it('kills a tool child that ignores SIGTERM', async () => {
    const child = runShell(`(trap '' TERM; sleep ${SLEEP}; sleep ${SLEEP}) & wait`);
    const supervisor = superviseChild(child, { timeoutMs: 200, killGraceMs: 300 });
    await supervisor.exit;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(survivors()).toEqual([]);
  });

  it('kills a tool child that ignores SIGTERM and redirected its output, after the backend has closed', async () => {
    const child = runShell(
      `(trap '' TERM; exec sleep ${SLEEP}) </dev/null >/dev/null 2>&1 & sleep 0.1; exec sleep 30`,
    );
    const supervisor = superviseChild(child, { timeoutMs: 300, killGraceMs: 400 });
    await supervisor.exit;
    expect(survivors()).toEqual([]);
  });

  it('settles at once when the group is empty after SIGTERM', async () => {
    const child = runShell('exec sleep 30');
    const supervisor = superviseChild(child, { timeoutMs: 100, killGraceMs: 5_000 });
    const elapsed = await settleTime(supervisor.exit);
    expect(elapsed).toBeLessThan(1_500);
    expect((await supervisor.exit).signal).toBe('SIGTERM');
  });

  it('settles when a process outside the group holds the pipe after SIGKILL', async () => {
    // perl POSIX::setsid leaves the group, so no group signal reaches it.
    const child = runShell(
      `perl -e 'use POSIX; POSIX::setsid(); exec("sleep", "${SLEEP}")' & sleep 0.2; trap '' TERM; while true; do sleep 1; done`,
    );
    const supervisor = superviseChild(child, { timeoutMs: 400, killGraceMs: 200 });
    const elapsed = await settleTime(supervisor.exit);
    expect(supervisor.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(3_000);
    expect(survivors().length).toBe(1);
  });

  it('settles with the real exit code and all output when a daemon holds the pipe after a clean exit', async () => {
    const child = runShell(
      `perl -e 'use POSIX; POSIX::setsid(); exec("sleep", "${SLEEP}")' & sleep 0.1; echo answer; exit 0`,
    );
    let out = '';
    let ended = false;
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stdout.on('end', () => { ended = true; });
    const supervisor = superviseChild(child, { timeoutMs: 0 });
    const result = await supervisor.exit;
    expect(result).toEqual({ code: 0, signal: null, spawnError: null });
    expect(out.trim()).toBe('answer');
    expect(ended).toBe(true);
    expect(supervisor.timedOut).toBe(false);
  });

  it('does not end the pipes while a slow reader still has output to take', async () => {
    const child = runShell(
      `perl -e 'use POSIX; POSIX::setsid(); exec("sleep", "${SLEEP}")' & sleep 0.1; head -c 1000000 /dev/zero; exit 0`,
    );
    const supervisor = superviseChild(child, { timeoutMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    let bytes = 0;
    for await (const chunk of child.stdout) bytes += (chunk as Buffer).length;
    expect(bytes).toBe(1_000_000);
    expect((await supervisor.exit).code).toBe(0);
  });

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('ends the child and removes its listener on %s', async (signal) => {
    const before = process.listenerCount(signal);
    const child = runShell(`sleep ${SLEEP} & wait`);
    const supervisor = superviseChild(child, { timeoutMs: 0, killGraceMs: 300 });
    expect(process.listenerCount(signal)).toBe(before + 1);
    process.emit(signal, signal);
    await supervisor.exit;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(supervisor.interruptedBy).toBe(signal);
    expect(supervisor.timedOut).toBe(false);
    expect(survivors()).toEqual([]);
    expect(process.listenerCount(signal)).toBe(before);
  });

  it('leaves tool children alone after a normal exit', async () => {
    const child = spawn('bash', ['-c', `sleep ${SLEEP} >/dev/null 2>&1 & exit 0`], {
      stdio: ['ignore', 'pipe', 'pipe'], ...ownProcessGroup(),
    });
    const supervisor = superviseChild(child, { timeoutMs: 5_000 });
    await supervisor.exit;
    supervisor.terminate();
    expect(survivors().length).toBe(1);
  });

  it('reports a spawn failure without hanging', async () => {
    const child = spawn('definitely-not-a-real-binary-xyz', [], {
      stdio: ['ignore', 'pipe', 'pipe'], ...ownProcessGroup(),
    });
    const result = await superviseChild(child, { timeoutMs: 1_000 }).exit;
    expect(result.spawnError?.message).toContain('ENOENT');
  });
});

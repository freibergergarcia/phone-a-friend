/**
 * Lifecycle of one backend subprocess: time limit, termination and settling.
 *
 * A relay must end within a short, fixed time after its limit or a signal, and
 * must not leave the backend or its tool children running. Three things stop a
 * plain `child.kill('SIGTERM')` and wait for `close` from doing that:
 *
 * - a child can ignore SIGTERM, so termination escalates to SIGKILL;
 * - a tool child can outlive the backend, so the signals go to a process group;
 * - any process can keep the stdout pipe open, and `close` waits for the pipe,
 *   so settling does not depend on `close` arriving.
 */
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

/** Time between SIGTERM and SIGKILL. */
export const KILL_GRACE_MS = 2_000;
/** Time for `close` to arrive after SIGKILL before the pipes are abandoned. */
const POST_KILL_SETTLE_MS = 500;
/** Time after the child exits for its output to drain, re-checked until drained. */
const POST_EXIT_DRAIN_MS = 2_000;
/** Time for the stream to end after its pipe is abandoned. */
const ABANDON_SETTLE_MS = 100;
/** How often to look for group members still running during termination. */
const GROUP_POLL_MS = 100;
/** The longest delay `setTimeout` honours; anything longer fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** The largest `--timeout` that fits in a timer: about 24.8 days. */
export const MAX_TIMEOUT_SECONDS = Math.floor(MAX_TIMER_MS / 1000);

/** The problem with a timeout value, or null when it is valid. `0` means no limit. */
export function timeoutProblem(seconds: number): string | null {
  if (!Number.isInteger(seconds) || seconds < 0) {
    return 'Timeout must be whole seconds, or 0 for no limit';
  }
  if (seconds > MAX_TIMEOUT_SECONDS) {
    return `Timeout must be at most ${MAX_TIMEOUT_SECONDS} seconds, or 0 for no limit`;
  }
  return null;
}

/**
 * Spawn options that give the child its own process group. `superviseChild()`
 * signals the group when the child was spawned with these. Not on Windows,
 * where there are no process groups and `detached` opens a new console.
 */
export function ownProcessGroup(): { detached: boolean } {
  return { detached: process.platform !== 'win32' };
}

export interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError: Error | null;
}

export interface ChildSupervisor {
  /** Resolves once the child has ended, or was abandoned after SIGKILL. Never rejects. */
  readonly exit: Promise<ChildExit>;
  /** The time limit fired. */
  readonly timedOut: boolean;
  /** The signal PaF received that ended the run, if any. */
  readonly interruptedBy: NodeJS.Signals | null;
  /** `exit` has resolved. */
  readonly ended: boolean;
  /** SIGTERM now, SIGKILL after the grace period. Safe to call more than once. */
  terminate(): void;
}

export interface SuperviseOptions {
  /** Time limit in milliseconds. `0` means no limit. */
  timeoutMs: number;
  /** Time between SIGTERM and SIGKILL. Defaults to `KILL_GRACE_MS`. */
  killGraceMs?: number;
}

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

export function superviseChild(child: ChildProcess, opts: SuperviseOptions): ChildSupervisor {
  const killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  let ended = false;
  let timedOut = false;
  let terminating = false;
  let closed = false;
  let interruptedBy: NodeJS.Signals | null = null;
  let exitStatus: { code: number | null; signal: NodeJS.Signals | null } = { code: null, signal: null };

  const signalChild = (signal: NodeJS.Signals): void => {
    if (ownProcessGroup().detached && child.pid) {
      try {
        // Reaches tool children, and works after the group leader has exited.
        process.kill(-child.pid, signal);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
      }
    }
    child.kill(signal);
  };

  const groupAlive = (): boolean => {
    if (!ownProcessGroup().detached || !child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  };

  const pipes = (): Readable[] => [child.stdout, child.stderr]
    .filter((pipe): pipe is Readable => Boolean(pipe) && !pipe?.destroyed);

  let finish: (spawnError: Error | null) => void = () => {};

  const abandonPipes = (): void => {
    for (const pipe of pipes()) pipe.destroy();
    later(() => finish(null), ABANDON_SETTLE_MS);
  };

  const terminate = (): void => {
    if (ended || terminating) return;
    terminating = true;
    signalChild('SIGTERM');
    later(() => {
      signalChild('SIGKILL');
      if (closed) finish(null);
      else later(abandonPipes, POST_KILL_SETTLE_MS);
    }, killGraceMs);
  };

  // A tool child that ignores SIGTERM and redirected its output can outlive the
  // backend's `close`. Hold the run open until the group is empty or SIGKILL has
  // been sent, or PaF could exit before sending it.
  const finishWhenGroupEmpty = (): void => {
    if (ended) return;
    if (groupAlive()) later(finishWhenGroupEmpty, GROUP_POLL_MS);
    else finish(null);
  };

  // A process that outlives the child can hold the pipes open, and then `close`
  // never comes. Ending the pipes is safe only once they are drained: an empty
  // buffer means the reader has taken everything, and anything still in the
  // kernel would have refilled the buffer. Ending, not destroying, lets a reader
  // finish normally. A held pipe does not make the run a failure.
  const endDrainedPipes = (): void => {
    if (ended || terminating) return;
    const open = pipes();
    if (open.some((pipe) => pipe.readableLength > 0)) {
      later(endDrainedPipes, POST_EXIT_DRAIN_MS);
      return;
    }
    for (const pipe of open) {
      pipe.once('end', () => pipe.destroy());
      pipe.push(null);
    }
    later(abandonPipes, POST_KILL_SETTLE_MS);
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    interruptedBy ??= signal;
    terminate();
  };

  const exit = new Promise<ChildExit>((resolve) => {
    finish = (spawnError) => {
      if (ended) return;
      ended = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const signal of FORWARDED_SIGNALS) process.removeListener(signal, onSignal);
      resolve({ ...exitStatus, spawnError });
    };
    child.once('error', (err) => finish(err));
    child.once('exit', (code, signal) => {
      exitStatus = { code, signal };
      later(endDrainedPipes, POST_EXIT_DRAIN_MS);
    });
    child.once('close', (code, signal) => {
      exitStatus = { code, signal };
      closed = true;
      if (terminating) finishWhenGroupEmpty();
      else finish(null);
    });
  });

  for (const signal of FORWARDED_SIGNALS) process.on(signal, onSignal);

  if (opts.timeoutMs > 0) {
    later(() => {
      timedOut = true;
      terminate();
    }, Math.min(opts.timeoutMs, MAX_TIMER_MS));
  }

  return {
    exit,
    terminate,
    get timedOut() { return timedOut; },
    get interruptedBy() { return interruptedBy; },
    get ended() { return ended; },
  };
}

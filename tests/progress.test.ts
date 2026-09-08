import { describe, it, expect, vi } from 'vitest';
import { createProgressReporter } from '../src/progress.js';
import { mergeObservers, type RelayObserver } from '../src/relay.js';

function reporter(interactive: boolean, spinner: { text: string } | null = null) {
  const lines: string[] = [];
  let now = 1_000_000;
  const r = createProgressReporter({
    write: (line) => lines.push(line),
    interactive,
    spinner,
    now: () => now,
  });
  return { r, lines, advance: (ms: number) => { now += ms; } };
}

describe('createProgressReporter (non-interactive)', () => {
  it('prints one timestamped line per reported activity and message, skipping turn markers', () => {
    const { r, lines, advance } = reporter(false);
    r.observer.onEvent!({ type: 'turn_started', message: 'Codex turn started' });
    advance(12_000);
    r.observer.onEvent!({ type: 'activity', message: 'Running: git diff' });
    advance(30_000);
    r.observer.onEvent!({ type: 'message', message: 'Found one race.' });
    r.observer.onEvent!({ type: 'turn_completed', message: 'Codex turn completed', data: { usage: {} } });
    expect(lines).toEqual(['  ◇ 00:12 Running: git diff', '  ◇ 00:42 Found one race.']);
  });

  it('prints scope, session, drift, and errors', () => {
    const { r, lines } = reporter(false);
    r.observer.onScope!({ scope: 'working-tree', base: 'main', diffHash: 'h', diffBytes: 720, diffFiles: 1 });
    r.observer.onSessionLinked!('01a0-thread');
    r.observer.onEvent!({ type: 'turn_failed', message: 'Codex turn failed: quota' });
    r.observer.onDrift!({ drifted: true, diffHash: 'h2' });
    expect(lines).toEqual([
      '  ◇ scope: 1 file(s) · 720 bytes (working-tree against main)',
      '  ◇ session: 01a0-thread',
      '  ◇ 00:00 Codex turn failed: quota',
    ]);
  });

  it('truncates long lines', () => {
    const { r, lines } = reporter(false);
    r.observer.onEvent!({ type: 'activity', message: 'y'.repeat(300) });
    expect(lines[0].length).toBeLessThanOrEqual(120);
    expect(lines[0].endsWith('…')).toBe(true);
  });

  it('prints a receipt with task id, duration, and drift on finish', () => {
    const { r, lines, advance } = reporter(false);
    r.observer.onDrift!({ drifted: false, diffHash: 'h' });
    advance(23_000);
    r.finish({ taskId: '319f3d35', status: 'completed' });
    expect(lines).toEqual(['  ◇ Task 319f3d35 completed · 23s · scope unchanged']);
  });

  it('warns loudly on drift and reports failures with the error head', () => {
    const drifted = reporter(false);
    drifted.r.observer.onDrift!({ drifted: true, diffHash: 'h2' });
    drifted.r.finish({ taskId: '319f3d35', status: 'completed' });
    expect(drifted.lines[0]).toBe('  ◇ Task 319f3d35 completed · 0s · tree changed during review');
    expect(drifted.lines[1]).toMatch(/Working tree changed during the review/);

    const failed = reporter(false);
    failed.advance(5_000);
    failed.r.finish({ taskId: null, status: 'failed', error: 'codex exec timed out after 600s' });
    expect(failed.lines).toEqual(['  ◇ failed · 5s · codex exec timed out after 600s']);
  });
});

describe('createProgressReporter (interactive)', () => {
  it('updates the spinner text instead of printing lines', () => {
    const spinner = { text: 'Reviewing via codex...' };
    const { r, lines, advance } = reporter(true, spinner);
    advance(12_000);
    r.observer.onEvent!({ type: 'activity', message: 'Running: git diff' });
    expect(lines).toEqual([]);
    expect(spinner.text).toBe('Reviewing via codex... · 00:12 Running: git diff');
    r.observer.onEvent!({ type: 'activity', message: 'Finished (exit 0): git diff' });
    expect(spinner.text).toBe('Reviewing via codex... · 00:12 Finished (exit 0): git diff');
    r.finish({ taskId: 'abcd1234', status: 'completed' });
    expect(lines).toEqual(['  ◇ Task abcd1234 completed · 12s']);
  });
});

describe('mergeObservers', () => {
  it('fans every hook out to each observer and tolerates missing hooks', () => {
    const a: RelayObserver = { onEvent: vi.fn(), onScope: vi.fn() };
    const b: RelayObserver = { onEvent: vi.fn(), onSessionLinked: vi.fn(), onDrift: vi.fn() };
    const merged = mergeObservers(a, undefined, b)!;
    merged.onEvent!({ type: 'activity', message: 'x' });
    merged.onScope!({ scope: 'branch', base: 'main', diffHash: 'h', diffBytes: 1, diffFiles: 1 });
    merged.onSessionLinked!('s');
    merged.onDrift!({ drifted: false, diffHash: 'h' });
    expect(a.onEvent).toHaveBeenCalledOnce();
    expect(b.onEvent).toHaveBeenCalledOnce();
    expect(a.onScope).toHaveBeenCalledOnce();
    expect(b.onSessionLinked).toHaveBeenCalledWith('s');
    expect(b.onDrift).toHaveBeenCalledOnce();
  });

  it('returns undefined when nothing is listening', () => {
    expect(mergeObservers(undefined, undefined)).toBeUndefined();
  });
});

/**
 * Progress reporter — turns relay observer hooks into human-readable stderr
 * lines (non-interactive) or spinner text updates (interactive), and prints a
 * one-line receipt when the run ends.
 *
 * Only backend-reported evidence is shown. Turn markers are skipped; drift is
 * reported once, in the receipt.
 */

import type { RelayDriftInfo, RelayObserver } from './relay.js';
import { formatElapsed, truncateDetail } from './status-line.js';

const MAX_DETAIL_CHARS = 96;
const SHOWN_EVENT_TYPES = new Set(['activity', 'message', 'turn_failed', 'error']);

export interface ProgressReporterOptions {
  /** Receives one complete line (no trailing newline). */
  write: (line: string) => void;
  /** True when stderr is a TTY and a spinner is painting; events then update the spinner text. */
  interactive: boolean;
  /** ora-compatible spinner; only its `text` property is used. */
  spinner?: { text: string } | null;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface ProgressFinish {
  taskId: string | null;
  status: 'completed' | 'failed';
  error?: string;
}

export interface ProgressReporter {
  observer: RelayObserver;
  finish(info: ProgressFinish): void;
}

export const DRIFT_WARNING =
  '  ! Working tree changed during the review. The result covers the original snapshot; re-run the review for the new changes.';

export function createProgressReporter(opts: ProgressReporterOptions): ProgressReporter {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const spinner = opts.interactive ? opts.spinner ?? null : null;
  const baseText = spinner?.text ?? '';
  let drift: RelayDriftInfo | null = null;

  const elapsed = (): string => formatElapsed(now() - startedAt);

  const show = (detail: string): void => {
    if (spinner) {
      spinner.text = `${baseText} · ${detail}`;
      return;
    }
    opts.write(`  ◇ ${detail}`);
  };

  return {
    observer: {
      onScope(info) {
        show(`scope: ${info.diffFiles} file(s) · ${info.diffBytes} bytes (${info.scope} against ${info.base})`);
      },
      onSessionLinked(backendSessionId) {
        show(`session: ${backendSessionId}`);
      },
      onEvent(event) {
        if (!SHOWN_EVENT_TYPES.has(event.type)) return;
        show(`${elapsed()} ${truncateDetail(event.message, MAX_DETAIL_CHARS)}`);
      },
      onDrift(info) {
        drift = info;
      },
    },
    finish(info) {
      const seconds = `${Math.round((now() - startedAt) / 1000)}s`;
      const parts = [info.taskId ? `Task ${info.taskId} ${info.status}` : info.status, seconds];
      if (info.status === 'completed' && drift) {
        parts.push(
          drift.drifted === true
            ? 'tree changed during review'
            : drift.drifted === false ? 'scope unchanged' : 'drift unknown',
        );
      } else if (info.status === 'failed' && info.error) {
        parts.push(truncateDetail(info.error, MAX_DETAIL_CHARS));
      }
      opts.write(`  ◇ ${parts.join(' · ')}`);
      if (drift?.drifted === true) opts.write(DRIFT_WARNING);
    },
  };
}

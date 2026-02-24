/**
 * Dashboard event sink — non-blocking bridge from CLI orchestrator to dashboard SSE.
 *
 * Batches events and POSTs them to the dashboard's /api/ingest endpoint.
 * Fire-and-forget: silently drops events if dashboard isn't running.
 */

import type { AgenticEvent } from '../agentic/events.js';

const DEFAULT_URL = 'http://127.0.0.1:7777/api/ingest';
const BATCH_INTERVAL_MS = 100;
const MAX_QUEUE_SIZE = 200;

export class DashboardEventSink {
  private queue: AgenticEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight = false;
  private url: string;
  private dropped = 0;

  constructor(dashboardUrl?: string) {
    this.url = dashboardUrl ?? DEFAULT_URL;
    this.timer = setInterval(() => this.flush(), BATCH_INTERVAL_MS);
  }

  /**
   * Enqueue an event for delivery. Non-blocking, never throws.
   */
  push(event: AgenticEvent): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.dropped++;
      return;
    }
    this.queue.push(event);
  }

  /**
   * Flush pending events to the dashboard. Skips if already inflight.
   */
  private async flush(): Promise<void> {
    if (this.inflight || this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    this.inflight = true;

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(250),
      });

      // If dashboard rejects, don't retry — it's observability, not critical
      if (!res.ok && this.dropped === 0) {
        // Silent — dashboard might not be running
      }
    } catch {
      // Dashboard not running or network error — silently drop
    } finally {
      this.inflight = false;
    }
  }

  /**
   * Final flush and cleanup.
   */
  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // One final flush attempt
    await this.flush();

    if (this.dropped > 0) {
      process.stderr.write(`  [dashboard-sink] dropped ${this.dropped} events (queue overflow)\n`);
    }
  }
}

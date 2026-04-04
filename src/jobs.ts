/**
 * Background job manager with JSON file persistence.
 *
 * Stores up to 50 jobs at ~/.config/phone-a-friend/jobs.json.
 * Prunes oldest completed/failed/cancelled jobs when the cap is exceeded.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  status: JobStatus;
  backend: string;
  prompt: string;
  repoPath: string;
  model?: string;
  sandbox?: string;
  pid?: number;
  progress?: string;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_JOBS = 50;

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class JobManager {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
      'phone-a-friend',
      'jobs.json',
    );
  }

  private load(): Job[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private save(jobs: Job[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(jobs, null, 2), 'utf-8');
  }

  create(opts: {
    backend: string;
    prompt: string;
    repoPath: string;
    model?: string;
    sandbox?: string;
  }): Job {
    const jobs = this.load();
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID().slice(0, 8),
      status: 'pending',
      backend: opts.backend,
      prompt: opts.prompt,
      repoPath: opts.repoPath,
      model: opts.model,
      sandbox: opts.sandbox,
      createdAt: now,
      updatedAt: now,
    };
    jobs.push(job);

    // Prune oldest completed/failed/cancelled jobs when over limit
    if (jobs.length > MAX_JOBS) {
      const prunable = jobs
        .filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const toRemove = jobs.length - MAX_JOBS;
      const removeIds = new Set(prunable.slice(0, toRemove).map(j => j.id));
      this.save(jobs.filter(j => !removeIds.has(j.id)));
      return job;
    }

    this.save(jobs);
    return job;
  }

  get(id: string): Job | null {
    return this.load().find(j => j.id === id) ?? null;
  }

  list(): Job[] {
    return this.load();
  }

  update(id: string, patch: Partial<Pick<Job, 'status' | 'result' | 'error' | 'pid' | 'progress'>>): Job | null {
    const jobs = this.load();
    const job = jobs.find(j => j.id === id);
    if (!job) return null;

    if (job.status === 'cancelled' || job.status === 'failed') {
      return job;
    }

    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.save(jobs);
    return job;
  }
}

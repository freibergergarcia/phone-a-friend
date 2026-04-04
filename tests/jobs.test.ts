import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobManager } from '../src/jobs.js';

describe('JobManager', () => {
  let tmpDir: string;
  let manager: JobManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paf-jobs-'));
    manager = new JobManager(join(tmpDir, 'jobs.json'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a job with pending status', () => {
    const job = manager.create({ backend: 'codex', prompt: 'Review this', repoPath: '/tmp/repo' });
    expect(job.id).toBeDefined();
    expect(job.status).toBe('pending');
    expect(job.backend).toBe('codex');
    expect(job.prompt).toBe('Review this');
    expect(job.repoPath).toBe('/tmp/repo');
    expect(job.createdAt).toBeDefined();
    expect(job.updatedAt).toBeDefined();
  });

  it('lists all jobs', () => {
    manager.create({ backend: 'codex', prompt: 'a', repoPath: '/tmp' });
    manager.create({ backend: 'codex', prompt: 'b', repoPath: '/tmp' });
    expect(manager.list()).toHaveLength(2);
  });

  it('gets a job by id', () => {
    const created = manager.create({ backend: 'codex', prompt: 'a', repoPath: '/tmp' });
    expect(manager.get(created.id)?.id).toBe(created.id);
  });

  it('updates job status and result', () => {
    const job = manager.create({ backend: 'codex', prompt: 'a', repoPath: '/tmp' });
    manager.update(job.id, { status: 'completed', result: 'All good' });
    const updated = manager.get(job.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.result).toBe('All good');
    expect(updated?.updatedAt).not.toBe(job.updatedAt);
  });

  it('updates job status to failed with error', () => {
    const job = manager.create({ backend: 'codex', prompt: 'a', repoPath: '/tmp' });
    manager.update(job.id, { status: 'failed', error: 'timeout' });
    const updated = manager.get(job.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('timeout');
  });

  it('tracks pid on update', () => {
    const job = manager.create({ backend: 'codex', prompt: 'a', repoPath: '/tmp' });
    manager.update(job.id, { status: 'running', pid: 12345 });
    expect(manager.get(job.id)?.pid).toBe(12345);
  });

  it('cancels a running job', () => {
    const job = manager.create({ backend: 'codex', prompt: 'a', repoPath: '/tmp' });
    manager.update(job.id, { status: 'running', pid: 12345 });
    manager.update(job.id, { status: 'cancelled' });
    expect(manager.get(job.id)?.status).toBe('cancelled');
  });

  it('prunes old completed jobs beyond max limit', () => {
    for (let i = 0; i < 55; i++) {
      const j = manager.create({ backend: 'codex', prompt: `job ${i}`, repoPath: '/tmp' });
      manager.update(j.id, { status: 'completed', result: 'done' });
    }
    expect(manager.list().length).toBeLessThanOrEqual(50);
  });

  it('persists across instances', () => {
    const path = join(tmpDir, 'jobs.json');
    const m1 = new JobManager(path);
    m1.create({ backend: 'codex', prompt: 'persist me', repoPath: '/tmp' });
    const m2 = new JobManager(path);
    expect(m2.list()).toHaveLength(1);
    expect(m2.list()[0].prompt).toBe('persist me');
  });

  it('returns null for unknown id', () => {
    expect(manager.get('nonexistent')).toBeNull();
  });

  it('returns null when updating unknown id', () => {
    expect(manager.update('nonexistent', { status: 'completed' })).toBeNull();
  });

  it('stores optional model and sandbox', () => {
    const job = manager.create({
      backend: 'codex',
      prompt: 'a',
      repoPath: '/tmp',
      model: 'o3',
      sandbox: 'read-only',
    });
    expect(job.model).toBe('o3');
    expect(job.sandbox).toBe('read-only');
  });
});

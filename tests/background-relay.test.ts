import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockRun = vi.fn();
vi.mock('../src/backends/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/backends/index.js')>();
  return {
    ...actual,
    getBackend: () => ({
      name: 'codex',
      localFileAccess: true,
      allowedSandboxes: new Set(['read-only', 'workspace-write', 'danger-full-access']),
      run: mockRun,
    }),
  };
});

import { relayBackground } from '../src/relay.js';
import { JobManager } from '../src/jobs.js';

describe('relayBackground()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paf-bg-'));
    mockRun.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates job and marks completed on success', async () => {
    mockRun.mockResolvedValue('Codex output');
    const manager = new JobManager(join(tmpDir, 'jobs.json'));
    const { job, promise } = relayBackground({
      prompt: 'Review this',
      repoPath: tmpDir,
      jobManager: manager,
    });
    expect(job.status).toBe('pending');
    expect(job.id).toBeDefined();

    await promise;

    const updated = manager.get(job.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.result).toBe('Codex output');
  });

  it('marks job as failed on backend error', async () => {
    mockRun.mockRejectedValue(new Error('codex crashed'));
    const manager = new JobManager(join(tmpDir, 'jobs.json'));
    const { job, promise } = relayBackground({
      prompt: 'Review this',
      repoPath: tmpDir,
      jobManager: manager,
    });

    await promise;

    const updated = manager.get(job.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('codex crashed');
  });

  it('sets job to running before relay starts', async () => {
    // Use a deferred promise so we can check intermediate state
    let resolveRelay!: (value: string) => void;
    mockRun.mockReturnValue(new Promise<string>((resolve) => { resolveRelay = resolve; }));

    const manager = new JobManager(join(tmpDir, 'jobs.json'));
    const { job } = relayBackground({
      prompt: 'Review',
      repoPath: tmpDir,
      jobManager: manager,
    });

    // Job should be running before relay resolves
    const running = manager.get(job.id);
    expect(running?.status).toBe('running');

    resolveRelay('done');
  });
});

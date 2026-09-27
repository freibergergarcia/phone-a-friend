import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Issue #173: four PaF processes opening a brand-new config directory at the
// same time used to fail on the WAL switch with SQLITE_BUSY (6 of 60 opens
// on the reporter's machine). Runs the built CLI, like the other e2e tests,
// because a child process cannot import the TypeScript sources.
describe('concurrent first open of the SQLite stores (built CLI)', () => {
  const entry = join(process.cwd(), 'dist', 'index.js');

  function runOnce(args: string[], configHome: string): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [entry, ...args], {
        env: { ...process.env, XDG_CONFIG_HOME: configHome, PHONE_A_FRIEND_UPDATE_CHECK: 'false', CI: 'true' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('close', (code) => resolve({ code, stderr }));
    });
  }

  it.each([
    ['task list (tasks.db)', ['task', 'list']],
    ['agentic logs (agentic.db)', ['agentic', 'logs']],
  ])('%s: 4 processes x 10 fresh config dirs all succeed', async (_name, args) => {
    const failures: string[] = [];
    for (let round = 0; round < 10; round++) {
      const configHome = mkdtempSync(join(tmpdir(), 'paf-concurrent-open-'));
      const results = await Promise.all([1, 2, 3, 4].map(() => runOnce(args, configHome)));
      for (const r of results) {
        if (r.code !== 0 || /database is locked/i.test(r.stderr)) failures.push(`round ${round}: exit ${r.code}: ${r.stderr.trim().slice(0, 120)}`);
      }
      rmSync(configHome, { recursive: true, force: true });
    }
    expect(failures).toEqual([]);
  }, 120_000);
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Claude version preflight through the built CLI', () => {
  let root: string;
  let bin: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-claude-preflight-'));
    bin = join(root, 'bin');
    mkdirSync(bin);
    // Ignore TERM like a wedged launcher, but self-exit so a failed test never
    // leaves a permanent child behind. No model request should start.
    writeFileSync(join(bin, 'claude'), `#!${process.execPath}
if (process.argv.includes('--version')) {
  process.on('SIGTERM', () => {});
  setTimeout(() => {
    require('node:fs').writeFileSync(${JSON.stringify(join(root, 'probe-expired'))}, 'unbounded');
    process.exit(23);
  }, 5500);
} else {
  console.error('MODEL_REQUEST_MUST_NOT_START');
  process.exit(42);
}
`, { mode: 0o755 });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each(['--no-stream', '--stream'])('bounds an unresponsive version probe for %s', stream => {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'dist/index.js'), '--to', 'claude', '--repo', root,
      '--peer-messaging', 'accept', '--no-task-history', stream, '--prompt', 'PONG',
    ], {
      cwd: root, encoding: 'utf8', timeout: 12_000, killSignal: 'SIGKILL',
      env: {
        PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
        XDG_CONFIG_HOME: join(root, 'config'), CLAUDE_CONFIG_DIR: join(root, 'claude'),
        PHONE_A_FRIEND_UPDATE_CHECK: 'false', TERM: 'dumb',
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('did not finish within 3s');
    expect(result.stderr).not.toContain('requires Claude Code');
    expect(result.stderr).not.toContain('MODEL_REQUEST_MUST_NOT_START');
    expect(existsSync(join(root, 'probe-expired'))).toBe(false);
  }, 15_000);
});

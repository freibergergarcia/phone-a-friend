import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock child_process for claude CLI calls
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: mockExecFileSync };
});

import {
  installHosts,
  uninstallHosts,
  verifyBackends,
  InstallerError,
  PLUGIN_NAME,
  MARKETPLACE_NAME,
} from '../src/installer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeRepo(): string {
  const repo = makeTempDir('phone-a-friend-repo-');
  const pluginDir = path.join(repo, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    '{"name":"phone-a-friend"}',
  );
  return repo;
}

function makeHome(): string {
  return makeTempDir('phone-a-friend-home-');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installer constants', () => {
  it('exports expected constants', () => {
    expect(PLUGIN_NAME).toBe('phone-a-friend');
    expect(MARKETPLACE_NAME).toBe('phone-a-friend-dev');
  });
});

describe('installHosts', () => {
  let repo: string;
  let claudeHome: string;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    repo = makeRepo();
    claudeHome = makeHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(claudeHome, { recursive: true, force: true }); } catch {}
  });

  it('installs via symlink', () => {
    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: false,
    });

    const target = path.join(claudeHome, 'plugins', 'phone-a-friend');
    const stat = fs.lstatSync(target);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(target)).toBe(fs.realpathSync(repo));
    expect(lines.some(l => l.includes('installed'))).toBe(true);
  });

  it('installs via copy', () => {
    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'copy',
      force: false,
      claudeHome,
      syncClaudeCli: false,
    });

    const target = path.join(claudeHome, 'plugins', 'phone-a-friend');
    const stat = fs.lstatSync(target);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(
      fs.existsSync(path.join(target, '.claude-plugin', 'plugin.json')),
    ).toBe(true);
    expect(lines.some(l => l.includes('installed'))).toBe(true);
  });

  it('detects already-installed symlink', () => {
    // First install
    installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: false,
    });

    // Second install — same symlink target
    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: false,
    });

    expect(lines.some(l => l.includes('already-installed'))).toBe(true);
  });

  it('raises when destination exists and force is false', () => {
    // Install once
    installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'copy',
      force: false,
      claudeHome,
      syncClaudeCli: false,
    });

    // Second install with different mode — should fail without force
    expect(() =>
      installHosts({
        repoRoot: repo,
        target: 'claude',
        mode: 'symlink',
        force: false,
        claudeHome,
        syncClaudeCli: false,
      }),
    ).toThrow(/already exists/);
  });

  it('replaces when force is true', () => {
    // Install via copy first
    installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'copy',
      force: false,
      claudeHome,
      syncClaudeCli: false,
    });

    // Force re-install via symlink
    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: true,
      claudeHome,
      syncClaudeCli: false,
    });

    const target = path.join(claudeHome, 'plugins', 'phone-a-friend');
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(lines.some(l => l.includes('installed'))).toBe(true);
  });

  it('raises on invalid repo root (no plugin.json)', () => {
    const invalidRepo = makeTempDir('phone-a-friend-invalid-');

    expect(() =>
      installHosts({
        repoRoot: invalidRepo,
        target: 'claude',
        syncClaudeCli: false,
      }),
    ).toThrow(/Invalid repo root/);

    fs.rmSync(invalidRepo, { recursive: true, force: true });
  });

  it('raises on invalid target', () => {
    expect(() =>
      installHosts({
        repoRoot: repo,
        target: 'invalid' as 'claude',
        syncClaudeCli: false,
      }),
    ).toThrow(/Invalid target/);
  });

  it('raises on invalid mode', () => {
    expect(() =>
      installHosts({
        repoRoot: repo,
        target: 'claude',
        mode: 'invalid' as 'symlink',
        syncClaudeCli: false,
      }),
    ).toThrow(/Invalid mode/);
  });

  it('syncs Claude CLI registration when syncClaudeCli is true', () => {
    // Mock `which` to find claude, then mock the 5 registration commands
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      // All claude plugin commands succeed
      return '';
    });

    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: true,
    });

    // Should have called claude plugin commands
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude',
    );
    expect(claudeCalls.length).toBe(5); // marketplace add, marketplace update, install, enable, update
    expect(lines.some(l => l.includes('marketplace_add: ok'))).toBe(true);
  });

  it('skips CLI sync when claude binary not found', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') throw new Error('not found');
      return '';
    });

    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: true,
    });

    expect(lines.some(l => l.includes('skipped'))).toBe(true);
    expect(lines.some(l => l.includes('claude binary not found'))).toBe(true);
  });
});

describe('uninstallHosts', () => {
  let repo: string;
  let claudeHome: string;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    repo = makeRepo();
    claudeHome = makeHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(claudeHome, { recursive: true, force: true }); } catch {}
  });

  it('removes installed symlink', () => {
    installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: false,
    });

    const lines = uninstallHosts({ target: 'claude', claudeHome });
    const target = path.join(claudeHome, 'plugins', 'phone-a-friend');
    expect(fs.existsSync(target)).toBe(false);
    expect(lines.some(l => l.includes('removed'))).toBe(true);
  });

  it('reports not-installed when nothing to remove', () => {
    const lines = uninstallHosts({ target: 'claude', claudeHome });
    expect(lines.some(l => l.includes('not-installed'))).toBe(true);
  });

  it('raises on invalid target', () => {
    expect(() =>
      uninstallHosts({ target: 'invalid' as 'claude' }),
    ).toThrow(/Invalid target/);
  });
});

describe('verifyBackends', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns availability map with hints', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'codex') return '/usr/bin/codex';
      throw new Error('not found');
    });

    const results = verifyBackends();
    const byName = Object.fromEntries(results.map(r => [r.name, r]));

    expect(byName['codex'].available).toBe(true);
    expect(byName['gemini'].available).toBe(false);
    expect(byName['gemini'].hint).toContain('npm');
  });
});

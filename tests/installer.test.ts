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
  isOpenCodeInstalled,
  isPluginInstalled,
  installFromGitHubMarketplace,
  getMarketplaceSourceType,
  opencodeCommandTarget,
  opencodeSkillTarget,
  InstallerError,
  PLUGIN_NAME,
  MARKETPLACE_NAME,
  GITHUB_REPO,
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
  const commandsDir = path.join(repo, 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });
  // OpenCode skills (active set after option C — phone-a-team was dropped)
  for (const name of ['phone-a-friend', 'curiosity-engine']) {
    const skillDir = path.join(repo, 'skills', name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: test skill\n---\n`,
    );
    fs.writeFileSync(
      path.join(commandsDir, `${name}.md`),
      '---\ndescription: test command\n---\n',
    );
  }
  // phone-a-team is Claude-only — has a command file but no OpenCode skill.
  fs.writeFileSync(
    path.join(commandsDir, 'phone-a-team.md'),
    '---\nname: phone-a-team\ndescription: test claude command\n---\n',
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
    expect(MARKETPLACE_NAME).toBe('phone-a-friend-marketplace');
  });
});

  describe('installHosts', () => {
    let repo: string;
    let claudeHome: string;
    let opencodeHome: string;

    beforeEach(() => {
      mockExecFileSync.mockReset();
      repo = makeRepo();
      claudeHome = makeHome();
      opencodeHome = makeHome();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(claudeHome, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(opencodeHome, { recursive: true, force: true }); } catch {}
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

    it('installs OpenCode skill and command shims', () => {
      const lines = installHosts({
        repoRoot: repo,
        target: 'opencode',
        mode: 'symlink',
        force: false,
        opencodeHome,
        syncClaudeCli: false,
      });

      const skillTarget = opencodeSkillTarget('phone-a-friend', opencodeHome);
      const commandTarget = opencodeCommandTarget('phone-a-friend', opencodeHome);

      expect(fs.lstatSync(skillTarget).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(skillTarget)).toBe(fs.realpathSync(path.join(repo, 'skills', 'phone-a-friend')));
      expect(fs.lstatSync(commandTarget).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(commandTarget)).toBe(fs.realpathSync(path.join(repo, 'commands', 'phone-a-friend.md')));
      expect(lines.some(l => l.includes('opencode_skill:phone-a-friend'))).toBe(true);
      expect(lines.some(l => l.includes('opencode_command:phone-a-friend'))).toBe(true);
      expect(lines.some(l => l.includes('opencode_skill:curiosity-engine'))).toBe(true);
      expect(lines.some(l => l.includes('opencode_command:curiosity-engine'))).toBe(true);
      // phone-a-team is Claude-only; must NOT be installed for OpenCode.
      expect(lines.some(l => l.includes('opencode_skill:phone-a-team') && !l.includes('removed'))).toBe(false);
      expect(fs.existsSync(opencodeSkillTarget('phone-a-team', opencodeHome))).toBe(false);
      expect(fs.existsSync(opencodeCommandTarget('phone-a-team', opencodeHome))).toBe(false);
      expect(lines.some(l => l.includes('claude:'))).toBe(false);
    });

    it('uses skills/<name>/COMMAND.opencode.md as the OpenCode command source when present', () => {
      // Add per-skill overlay for phone-a-friend (any active OpenCode skill works).
      const overlayPath = path.join(repo, 'skills', 'phone-a-friend', 'COMMAND.opencode.md');
      fs.writeFileSync(overlayPath, '---\ndescription: opencode overlay\n---\nuse the skill\n');

      installHosts({
        repoRoot: repo,
        target: 'opencode',
        mode: 'symlink',
        force: false,
        opencodeHome,
        syncClaudeCli: false,
      });

      const phoneAFriendCmd = opencodeCommandTarget('phone-a-friend', opencodeHome);
      const curiosityCmd = opencodeCommandTarget('curiosity-engine', opencodeHome);

      // phone-a-friend uses the overlay
      expect(fs.realpathSync(phoneAFriendCmd)).toBe(fs.realpathSync(overlayPath));
      // curiosity-engine (no overlay) still uses commands/<name>.md
      expect(fs.realpathSync(curiosityCmd)).toBe(
        fs.realpathSync(path.join(repo, 'commands', 'curiosity-engine.md')),
      );
    });

    it('migrates a stale OpenCode command symlink that points into the same repo', () => {
      // Simulate prior install: command symlink → commands/phone-a-friend.md
      installHosts({
        repoRoot: repo,
        target: 'opencode',
        mode: 'symlink',
        force: false,
        opencodeHome,
        syncClaudeCli: false,
      });
      const cmdTarget = opencodeCommandTarget('phone-a-friend', opencodeHome);
      expect(fs.realpathSync(cmdTarget)).toBe(
        fs.realpathSync(path.join(repo, 'commands', 'phone-a-friend.md')),
      );

      // Now add an overlay and reinstall WITHOUT --force; the existing symlink
      // points inside the repo (PaF-owned) so it should be auto-replaced.
      const overlayPath = path.join(repo, 'skills', 'phone-a-friend', 'COMMAND.opencode.md');
      fs.writeFileSync(overlayPath, '---\ndescription: opencode overlay\n---\nuse the skill\n');

      installHosts({
        repoRoot: repo,
        target: 'opencode',
        mode: 'symlink',
        force: false,
        opencodeHome,
        syncClaudeCli: false,
      });

      expect(fs.realpathSync(cmdTarget)).toBe(fs.realpathSync(overlayPath));
    });

    it('does not auto-replace a symlink that points outside the repo', () => {
      // Pre-create an unrelated file outside the repo and symlink the
      // OpenCode command target at it. The installer should refuse to
      // overwrite without force, since this was not PaF-managed.
      const foreign = makeTempDir('paf-foreign-');
      const foreignFile = path.join(foreign, 'phone-a-friend.md');
      fs.writeFileSync(foreignFile, 'not ours\n');

      const cmdTarget = opencodeCommandTarget('phone-a-friend', opencodeHome);
      fs.mkdirSync(path.dirname(cmdTarget), { recursive: true });
      fs.symlinkSync(foreignFile, cmdTarget);

      try {
        expect(() =>
          installHosts({
            repoRoot: repo,
            target: 'opencode',
            mode: 'symlink',
            force: false,
            opencodeHome,
            syncClaudeCli: false,
          }),
        ).toThrow(/already exists/);
      } finally {
        try { fs.rmSync(foreign, { recursive: true, force: true }); } catch {}
      }
    });

    it('removes legacy phone-a-team symlinks from prior OpenCode installs (PaF-owned)', () => {
      // Simulate a user whose previous PaF install symlinked phone-a-team
      // into ~/.config/opencode/. After option C those source files no longer
      // exist in the repo, leaving broken symlinks. The cleanup pass should
      // remove them.
      const legacySkillDir = opencodeSkillTarget('phone-a-team', opencodeHome);
      const legacyCmd = opencodeCommandTarget('phone-a-team', opencodeHome);
      // Source files we'll point at, then delete to simulate the post-option-C
      // state where the symlinks are broken.
      const fakeSkillSource = path.join(repo, 'skills', 'phone-a-team');
      const fakeCmdSource = path.join(repo, 'commands', 'phone-a-team-legacy.md');
      fs.mkdirSync(fakeSkillSource, { recursive: true });
      fs.writeFileSync(path.join(fakeSkillSource, 'SKILL.md'), 'legacy');
      fs.writeFileSync(fakeCmdSource, 'legacy');
      // Create the user's existing PaF-owned symlinks.
      fs.mkdirSync(path.dirname(legacySkillDir), { recursive: true });
      fs.symlinkSync(fakeSkillSource, legacySkillDir);
      fs.mkdirSync(path.dirname(legacyCmd), { recursive: true });
      fs.symlinkSync(fakeCmdSource, legacyCmd);
      // Now delete the source files to simulate the broken-symlink case.
      fs.rmSync(fakeSkillSource, { recursive: true, force: true });
      fs.rmSync(fakeCmdSource, { force: true });

      const lines = installHosts({
        repoRoot: repo,
        target: 'opencode',
        mode: 'symlink',
        force: false,
        opencodeHome,
        syncClaudeCli: false,
      });

      // Symlinks themselves should be gone (even though their targets were
      // already deleted — fs.lstat on a removed symlink throws ENOENT).
      expect(() => fs.lstatSync(legacySkillDir)).toThrow();
      expect(() => fs.lstatSync(legacyCmd)).toThrow();
      expect(lines.some(l => l.includes('opencode_skill:phone-a-team') && l.includes('removed'))).toBe(true);
      expect(lines.some(l => l.includes('opencode_command:phone-a-team') && l.includes('removed'))).toBe(true);
    });

    it('preserves user-authored phone-a-team files (not PaF-owned)', () => {
      // A user might manually author their own phone-a-team skill for OpenCode
      // (e.g. a homemade portable team workflow). PaF must not silently delete
      // their work during the legacy cleanup pass.
      const userSkillDir = opencodeSkillTarget('phone-a-team', opencodeHome);
      const userCmd = opencodeCommandTarget('phone-a-team', opencodeHome);
      fs.mkdirSync(userSkillDir, { recursive: true });
      fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), '---\nname: phone-a-team\ndescription: my own version\n---\n');
      fs.mkdirSync(path.dirname(userCmd), { recursive: true });
      fs.writeFileSync(userCmd, '---\ndescription: my own version\n---\n');

      const lines = installHosts({
        repoRoot: repo,
        target: 'opencode',
        mode: 'symlink',
        force: false,
        opencodeHome,
        syncClaudeCli: false,
      });

      // Files survive untouched.
      expect(fs.existsSync(userSkillDir)).toBe(true);
      expect(fs.existsSync(userCmd)).toBe(true);
      // Cleanup logs a "kept" line so users see what happened.
      expect(lines.some(l => l.includes('opencode_skill:phone-a-team') && l.includes('kept'))).toBe(true);
      expect(lines.some(l => l.includes('opencode_command:phone-a-team') && l.includes('kept'))).toBe(true);
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

  it('recovers from broken (dangling) symlink with force', () => {
    const pluginDir = path.join(claudeHome, 'plugins');
    fs.mkdirSync(pluginDir, { recursive: true });
    const target = path.join(pluginDir, 'phone-a-friend');

    // Create a dangling symlink pointing to a non-existent path
    fs.symlinkSync('/tmp/nonexistent-paf-target', target);
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);

    // Force install should recover
    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: true,
      claudeHome,
      syncClaudeCli: false,
    });

    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(target)).toBe(fs.realpathSync(repo));
    expect(lines.some(l => l.includes('installed'))).toBe(true);
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

    // Should have called claude plugin commands:
    // 3 legacy cleanup (disable, uninstall, marketplace remove) + 5 registration (marketplace add, update, install, enable, update)
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude',
    );
    expect(claudeCalls.length).toBe(8);
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

  it('removes marketplace registration on uninstall', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = uninstallHosts({ target: 'claude', claudeHome });

    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude',
    );
    // Should call: disable, uninstall, marketplace remove (+ legacy variants)
    const marketplaceRemoveCalls = claudeCalls.filter(
      (c: unknown[]) => (c[1] as string[]).includes('marketplace') && (c[1] as string[]).includes('remove'),
    );
    expect(marketplaceRemoveCalls.length).toBeGreaterThanOrEqual(1);
    expect(lines.some(l => l.includes('marketplace_remove'))).toBe(true);
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

describe('isPluginInstalled (marketplace cache)', () => {
  it('returns true when plugin exists in marketplace cache', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    const cacheDir = path.join(tmpHome, 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME);
    fs.mkdirSync(cacheDir, { recursive: true });
    expect(isPluginInstalled(tmpHome)).toBe(true);
    fs.rmSync(tmpHome, { recursive: true });
  });

  it('returns false when neither local nor cache install exists', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    fs.mkdirSync(path.join(tmpHome, 'plugins'), { recursive: true });
    expect(isPluginInstalled(tmpHome)).toBe(false);
    fs.rmSync(tmpHome, { recursive: true });
  });

  it('returns true when local symlink exists (existing behavior)', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    const repo = makeRepo();
    const pluginPath = path.join(tmpHome, 'plugins', PLUGIN_NAME);
    fs.mkdirSync(path.join(tmpHome, 'plugins'), { recursive: true });
    fs.symlinkSync(repo, pluginPath);
    expect(isPluginInstalled(tmpHome)).toBe(true);
    fs.rmSync(tmpHome, { recursive: true });
    fs.rmSync(repo, { recursive: true });
  });
});

describe('isOpenCodeInstalled', () => {
  it('returns true when all OpenCode skills and command shims exist', () => {
    const repo = makeRepo();
    const opencodeHome = makeHome();
    installHosts({
      repoRoot: repo,
      target: 'opencode',
      mode: 'symlink',
      force: false,
      opencodeHome,
      syncClaudeCli: false,
    });

    expect(isOpenCodeInstalled(opencodeHome)).toBe(true);

    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(opencodeHome, { recursive: true, force: true });
  });

  it('returns false when any OpenCode command shim is missing', () => {
    const repo = makeRepo();
    const opencodeHome = makeHome();
    installHosts({
      repoRoot: repo,
      target: 'opencode',
      mode: 'symlink',
      force: false,
      opencodeHome,
      syncClaudeCli: false,
    });

    fs.rmSync(opencodeCommandTarget('phone-a-friend', opencodeHome), { force: true });
    expect(isOpenCodeInstalled(opencodeHome)).toBe(false);

    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(opencodeHome, { recursive: true, force: true });
  });
});

describe('installFromGitHubMarketplace', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls claude plugin commands with GitHub repo as source', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = installFromGitHubMarketplace();

    // Verify marketplace add uses GitHub repo, not a local path
    const marketplaceAddCall = mockExecFileSync.mock.calls.find(
      (c: unknown[]) =>
        c[0] === 'claude' &&
        (c[1] as string[]).includes('marketplace') &&
        (c[1] as string[]).includes('add'),
    );
    expect(marketplaceAddCall).toBeDefined();
    expect((marketplaceAddCall![1] as string[])).toContain(GITHUB_REPO);
    expect(lines.some(l => l.includes('marketplace_add: ok'))).toBe(true);
  });

  it('cleans up existing local symlink before marketplace registration', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    const repo = makeRepo();
    const pluginDir = path.join(tmpHome, 'plugins');
    fs.mkdirSync(pluginDir, { recursive: true });
    const target = path.join(pluginDir, PLUGIN_NAME);
    fs.symlinkSync(repo, target);
    expect(fs.existsSync(target)).toBe(true);

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    // Note: installFromGitHubMarketplace uses default homedir, not our temp.
    // We test the uninstallHosts call is included in the output.
    const lines = installFromGitHubMarketplace();
    expect(lines.some(l => l.includes('uninstaller'))).toBe(true);

    fs.rmSync(tmpHome, { recursive: true });
    fs.rmSync(repo, { recursive: true });
  });

  it('succeeds even when no local symlink exists (idempotent)', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = installFromGitHubMarketplace();
    // uninstallHosts reports not-installed, but no error
    expect(lines.some(l => l.includes('not-installed') || l.includes('marketplace_add: ok'))).toBe(true);
  });

  it('exports GITHUB_REPO constant', () => {
    expect(GITHUB_REPO).toBe('freibergergarcia/phone-a-friend');
  });
});

describe('getMarketplaceSourceType', () => {
  it('returns source type for remote marketplace (github)', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    const pluginsDir = path.join(tmpHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'github', repo: 'freibergergarcia/phone-a-friend' },
        },
      }),
    );
    expect(getMarketplaceSourceType(MARKETPLACE_NAME, tmpHome)).toBe('github');
    fs.rmSync(tmpHome, { recursive: true });
  });

  it('returns null for local directory marketplace', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    const pluginsDir = path.join(tmpHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'directory', path: '/some/local/path' },
        },
      }),
    );
    expect(getMarketplaceSourceType(MARKETPLACE_NAME, tmpHome)).toBeNull();
    fs.rmSync(tmpHome, { recursive: true });
  });

  it('returns null when marketplace is not registered', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    const pluginsDir = path.join(tmpHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({}),
    );
    expect(getMarketplaceSourceType(MARKETPLACE_NAME, tmpHome)).toBeNull();
    fs.rmSync(tmpHome, { recursive: true });
  });

  it('returns null when registry file does not exist', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    expect(getMarketplaceSourceType(MARKETPLACE_NAME, tmpHome)).toBeNull();
    fs.rmSync(tmpHome, { recursive: true });
  });
});

describe('uninstallHosts marketplace unsync guard', () => {
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

  it('auto mode skips unsync when marketplace has remote source', () => {
    const pluginsDir = path.join(claudeHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'github', repo: 'freibergergarcia/phone-a-friend' },
        },
      }),
    );

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = uninstallHosts({ target: 'claude', claudeHome });

    expect(lines.some(l => l.includes('skipped') && l.includes('github'))).toBe(true);
    expect(lines.some(l => l.includes('--purge-marketplace'))).toBe(true);
    // Should NOT have called claude plugin disable/uninstall/marketplace remove
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude',
    );
    expect(claudeCalls.length).toBe(0);
  });

  it('auto mode proceeds when marketplace has directory source', () => {
    const pluginsDir = path.join(claudeHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'directory', path: '/some/local/path' },
        },
      }),
    );

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = uninstallHosts({ target: 'claude', claudeHome });

    expect(lines.some(l => l.includes('disable: ok') || l.includes('marketplace_remove: ok'))).toBe(true);
  });

  it('auto mode proceeds when registry does not exist', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = uninstallHosts({ target: 'claude', claudeHome });

    // No remote source detected, so unsync proceeds
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude',
    );
    expect(claudeCalls.length).toBeGreaterThan(0);
  });

  it('always mode unsyncs even with remote source', () => {
    const pluginsDir = path.join(claudeHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'github', repo: 'freibergergarcia/phone-a-friend' },
        },
      }),
    );

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = uninstallHosts({
      target: 'claude',
      claudeHome,
      claudeCliUnsync: 'always',
    });

    // Should have called claude commands despite remote source
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude',
    );
    expect(claudeCalls.length).toBeGreaterThan(0);
    expect(lines.some(l => l.includes('marketplace_remove: ok'))).toBe(true);
  });

  it('never mode skips unsync entirely', () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = uninstallHosts({
      target: 'claude',
      claudeHome,
      claudeCliUnsync: 'never',
    });

    expect(lines.some(l => l.includes('claude_cli_unsync: skipped'))).toBe(true);
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude',
    );
    expect(claudeCalls.length).toBe(0);
  });
});

describe('installHosts marketplace sync guard', () => {
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

  it('skips sync when marketplace has remote source', () => {
    // Set up a remote marketplace registration
    const pluginsDir = path.join(claudeHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'github', repo: 'freibergergarcia/phone-a-friend' },
        },
      }),
    );

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
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

    expect(lines.some(l => l.includes('skipped') && l.includes('github'))).toBe(true);
    // Should NOT have called claude plugin marketplace add
    const marketplaceAddCalls = mockExecFileSync.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'claude' &&
        (c[1] as string[]).includes('marketplace') &&
        (c[1] as string[]).includes('add'),
    );
    expect(marketplaceAddCalls.length).toBe(0);
  });

  it('allows sync when forceMarketplaceSync is true', () => {
    const pluginsDir = path.join(claudeHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'github', repo: 'freibergergarcia/phone-a-friend' },
        },
      }),
    );

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: true,
      forceMarketplaceSync: true,
    });

    expect(lines.some(l => l.includes('marketplace_add: ok'))).toBe(true);
  });

  it('syncs normally when marketplace has directory source', () => {
    const pluginsDir = path.join(claudeHome, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        [MARKETPLACE_NAME]: {
          source: { source: 'directory', path: '/some/local/path' },
        },
      }),
    );

    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/local/bin/claude';
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

    expect(lines.some(l => l.includes('marketplace_add: ok'))).toBe(true);
  });
});

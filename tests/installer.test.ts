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
  isCodexInstalled,
  isPluginInstalled,
  installFromGitHubMarketplace,
  getMarketplaceSourceType,
  opencodeCommandTarget,
  opencodeSkillTarget,
  codexConfigRoot,
  codexSkillTarget,
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
  // phone-a-team has a Claude command file at commands/phone-a-team.md and
  // a Codex-only overlay at skills/phone-a-team/.codex/SKILL.md (no
  // host-neutral SKILL.md, so OpenCode does not install it).
  fs.writeFileSync(
    path.join(commandsDir, 'phone-a-team.md'),
    '---\nname: phone-a-team\ndescription: test claude command\n---\n',
  );
  const phoneATeamCodexDir = path.join(repo, 'skills', 'phone-a-team', '.codex');
  fs.mkdirSync(phoneATeamCodexDir, { recursive: true });
  fs.writeFileSync(
    path.join(phoneATeamCodexDir, 'SKILL.md'),
    '---\nname: phone-a-team\ndescription: test codex overlay\n---\n',
  );
  // Codex subagent personas (Codex installer reads agents/codex/paf-*.toml).
  const codexAgentsDir = path.join(repo, 'agents', 'codex');
  fs.mkdirSync(codexAgentsDir, { recursive: true });
  for (const name of ['paf-reviewer', 'paf-critic', 'paf-synthesizer']) {
    fs.writeFileSync(
      path.join(codexAgentsDir, `${name}.toml`),
      `name = "${name}"\ndescription = "test ${name}"\ndeveloper_instructions = "test instructions"\n`,
    );
  }
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
    });

    // Second install — same symlink target
    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome,
      syncClaudeCli: false,
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
    });

    // Force re-install via symlink
    const lines = installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: true,
      claudeHome,
      syncClaudeCli: false,
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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
      syncCodexCli: false,
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

  it('preserves user-authored phone-a-team files on uninstall --opencode', () => {
    // Same safety property as the install-time legacy cleanup: a user who
    // hand-authored their own phone-a-team skill must not lose it when they
    // run `phone-a-friend plugin uninstall --opencode`.
    const opencodeHome = makeHome();
    try {
      const userSkillDir = opencodeSkillTarget('phone-a-team', opencodeHome);
      const userCmd = opencodeCommandTarget('phone-a-team', opencodeHome);
      fs.mkdirSync(userSkillDir, { recursive: true });
      fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), '---\nname: phone-a-team\ndescription: my own version\n---\n');
      fs.mkdirSync(path.dirname(userCmd), { recursive: true });
      fs.writeFileSync(userCmd, '---\ndescription: my own version\n---\n');

      const lines = uninstallHosts({
        target: 'opencode',
        opencodeHome,
        repoRoot: repo,
      });

      expect(fs.existsSync(userSkillDir)).toBe(true);
      expect(fs.existsSync(userCmd)).toBe(true);
      expect(lines.some(l => l.includes('opencode_skill:phone-a-team') && l.includes('kept'))).toBe(true);
      expect(lines.some(l => l.includes('opencode_command:phone-a-team') && l.includes('kept'))).toBe(true);
    } finally {
      try { fs.rmSync(opencodeHome, { recursive: true, force: true }); } catch {}
    }
  });

  it('removes PaF-owned legacy phone-a-team symlinks on uninstall --opencode', () => {
    const opencodeHome = makeHome();
    try {
      const legacySkillDir = opencodeSkillTarget('phone-a-team', opencodeHome);
      const legacyCmd = opencodeCommandTarget('phone-a-team', opencodeHome);
      // Source files inside the test repo, then deleted to simulate the
      // post-option-C broken-symlink state.
      const fakeSkillSource = path.join(repo, 'skills', 'phone-a-team');
      const fakeCmdSource = path.join(repo, 'commands', 'phone-a-team-uninstall.md');
      fs.mkdirSync(fakeSkillSource, { recursive: true });
      fs.writeFileSync(path.join(fakeSkillSource, 'SKILL.md'), 'legacy');
      fs.writeFileSync(fakeCmdSource, 'legacy');
      fs.mkdirSync(path.dirname(legacySkillDir), { recursive: true });
      fs.symlinkSync(fakeSkillSource, legacySkillDir);
      fs.mkdirSync(path.dirname(legacyCmd), { recursive: true });
      fs.symlinkSync(fakeCmdSource, legacyCmd);
      fs.rmSync(fakeSkillSource, { recursive: true, force: true });
      fs.rmSync(fakeCmdSource, { force: true });

      const lines = uninstallHosts({
        target: 'opencode',
        opencodeHome,
        repoRoot: repo,
      });

      expect(() => fs.lstatSync(legacySkillDir)).toThrow();
      expect(() => fs.lstatSync(legacyCmd)).toThrow();
      expect(lines.some(l => l.includes('opencode_skill:phone-a-team') && l.includes('removed'))).toBe(true);
      expect(lines.some(l => l.includes('opencode_command:phone-a-team') && l.includes('removed'))).toBe(true);
    } finally {
      try { fs.rmSync(opencodeHome, { recursive: true, force: true }); } catch {}
    }
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
      syncCodexCli: false,
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
      syncCodexCli: false,
    });

    fs.rmSync(opencodeCommandTarget('phone-a-friend', opencodeHome), { force: true });
    expect(isOpenCodeInstalled(opencodeHome)).toBe(false);

    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(opencodeHome, { recursive: true, force: true });
  });
});

describe('Codex host integration', () => {
  let repo: string;
  let codexHome: string;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    repo = makeRepo();
    codexHome = makeHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(codexHome, { recursive: true, force: true }); } catch {}
  });

  it('installs Codex skills via symlink', () => {
    const lines = installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    const skillTarget = codexSkillTarget('phone-a-friend', codexHome);
    expect(fs.lstatSync(skillTarget).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(skillTarget)).toBe(
      fs.realpathSync(path.join(repo, 'skills', 'phone-a-friend')),
    );

    const curiosityTarget = codexSkillTarget('curiosity-engine', codexHome);
    expect(fs.lstatSync(curiosityTarget).isSymbolicLink()).toBe(true);

    expect(lines.some(l => l.includes('codex_skill:phone-a-friend'))).toBe(true);
    expect(lines.some(l => l.includes('codex_skill:curiosity-engine'))).toBe(true);
    // phone-a-team is installed for Codex via the .codex/ overlay
    // (Codex-tuned Bash-orchestrated iterative refinement, no subagent spawn).
    expect(fs.existsSync(codexSkillTarget('phone-a-team', codexHome))).toBe(true);
    expect(lines.some(l => l.includes('codex_skill:phone-a-team'))).toBe(true);
    // No claude artifacts created.
    expect(lines.some(l => l.startsWith('- claude:'))).toBe(false);
  });

  it('uses skills/<name>/.codex/ as the Codex skill source when present', () => {
    // Author a Codex-tuned overlay.
    const overlayDir = path.join(repo, 'skills', 'phone-a-friend', '.codex');
    fs.mkdirSync(overlayDir, { recursive: true });
    fs.writeFileSync(
      path.join(overlayDir, 'SKILL.md'),
      '---\nname: phone-a-friend\ndescription: codex overlay\n---\n',
    );

    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    const skillTarget = codexSkillTarget('phone-a-friend', codexHome);
    expect(fs.realpathSync(skillTarget)).toBe(fs.realpathSync(overlayDir));

    // curiosity-engine (no overlay) still uses skills/<name>/.
    const curiosityTarget = codexSkillTarget('curiosity-engine', codexHome);
    expect(fs.realpathSync(curiosityTarget)).toBe(
      fs.realpathSync(path.join(repo, 'skills', 'curiosity-engine')),
    );
  });

  it('installs via copy', () => {
    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'copy',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    const skillTarget = codexSkillTarget('phone-a-friend', codexHome);
    const stat = fs.lstatSync(skillTarget);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(skillTarget, 'SKILL.md'))).toBe(true);
  });

  it('does not install Codex skills when target=claude', () => {
    installHosts({
      repoRoot: repo,
      target: 'claude',
      mode: 'symlink',
      force: false,
      claudeHome: makeHome(),
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    expect(fs.existsSync(codexSkillTarget('phone-a-friend', codexHome))).toBe(false);
  });

  it('target=all installs all three hosts', () => {
    const claudeHome = makeHome();
    const opencodeHome = makeHome();
    try {
      const lines = installHosts({
        repoRoot: repo,
        target: 'all',
        mode: 'symlink',
        force: false,
        claudeHome,
        opencodeHome,
        codexHome,
        syncClaudeCli: false,
      syncCodexCli: false,
      });

      expect(fs.existsSync(path.join(claudeHome, 'plugins', 'phone-a-friend'))).toBe(true);
      expect(fs.existsSync(opencodeSkillTarget('phone-a-friend', opencodeHome))).toBe(true);
      expect(fs.existsSync(codexSkillTarget('phone-a-friend', codexHome))).toBe(true);
      expect(lines.some(l => l.includes('codex_skill:phone-a-friend'))).toBe(true);
    } finally {
      try { fs.rmSync(claudeHome, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(opencodeHome, { recursive: true, force: true }); } catch {}
    }
  });

  it('uninstall removes Codex skills', () => {
    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });
    expect(fs.existsSync(codexSkillTarget('phone-a-friend', codexHome))).toBe(true);

    const lines = uninstallHosts({
      target: 'codex',
      codexHome,
      repoRoot: repo,
    });

    expect(fs.existsSync(codexSkillTarget('phone-a-friend', codexHome))).toBe(false);
    expect(fs.existsSync(codexSkillTarget('curiosity-engine', codexHome))).toBe(false);
    expect(lines.some(l => l.includes('codex_skill:phone-a-friend') && l.includes('removed'))).toBe(true);
  });

  it('isCodexInstalled reflects skill presence', () => {
    expect(isCodexInstalled(codexHome)).toBe(false);

    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });
    expect(isCodexInstalled(codexHome)).toBe(true);

    fs.rmSync(codexSkillTarget('phone-a-friend', codexHome), { recursive: true, force: true });
    expect(isCodexInstalled(codexHome)).toBe(false);
  });

  it('honors CODEX_HOME env var when codexHome not passed', () => {
    const envHome = makeHome();
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = envHome;
    try {
      expect(codexConfigRoot()).toBe(envHome);
      installHosts({
        repoRoot: repo,
        target: 'codex',
        mode: 'symlink',
        force: false,
        syncClaudeCli: false,
      syncCodexCli: false,
      });
      expect(fs.existsSync(path.join(envHome, 'skills', 'phone-a-friend', 'SKILL.md'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
      try { fs.rmSync(envHome, { recursive: true, force: true }); } catch {}
    }
  });

  it('reinstall is idempotent (already-installed)', () => {
    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    const lines = installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    expect(lines.some(l => l.includes('already-installed'))).toBe(true);
  });

  it('install does NOT ship paf-* subagent personas (legacy design dropped)', () => {
    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    for (const name of ['paf-reviewer', 'paf-critic', 'paf-synthesizer']) {
      const target = path.join(codexHome, 'agents', `${name}.toml`);
      expect(fs.existsSync(target)).toBe(false);
    }
  });

  it('install cleans up legacy paf-* symlinks from a prior subagent install', () => {
    // Simulate a stale install: drop paf-* symlinks pointing back into the
    // current repo, as the prior installer version would have done.
    const agentsDir = path.join(codexHome, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    // The current repo doesn't actually have agents/codex/paf-*.toml source
    // files anymore (they were removed conceptually; physically the files
    // still exist for now, so the symlink points at a real file). What
    // matters for the cleanup logic is that the symlink resolves into the
    // repo, which marks it PaF-owned.
    const fakeSource = path.join(repo, 'agents', 'codex', 'paf-reviewer.toml');
    fs.symlinkSync(fakeSource, path.join(agentsDir, 'paf-reviewer.toml'));

    const lines = installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    expect(fs.existsSync(path.join(agentsDir, 'paf-reviewer.toml'))).toBe(false);
    expect(lines.some(l => l.includes('paf-reviewer') && l.includes('removed'))).toBe(true);
  });

  it('isCodexInstalled tracks skills only (no longer requires agents)', () => {
    expect(isCodexInstalled(codexHome)).toBe(false);

    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });
    expect(isCodexInstalled(codexHome)).toBe(true);

    // Even with a non-existent legacy agents dir, install state is true
    // because we no longer install paf-*.toml files.
    expect(fs.existsSync(path.join(codexHome, 'agents'))).toBe(false);
    expect(isCodexInstalled(codexHome)).toBe(true);
  });

  it('--no-codex-cli-sync skips the codex shell-out (no marketplace_add line)', () => {
    // Mock `which codex` as success so the gate is the syncCodexCli flag,
    // not binary presence. If syncCodexCli=false suppresses correctly, we
    // should see no codex_cli_marketplace_add line.
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'codex') return '/usr/bin/codex';
      // Anything else: treat as the real exec (shouldn't be called)
      return '';
    });

    const lines = installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    expect(lines.some(l => l.includes('codex_cli_marketplace_add'))).toBe(false);
    expect(lines.some(l => l.includes('codex_cli_plugin_add'))).toBe(false);
  });

  it('syncCodexCli=true issues marketplace_add + plugin_add when codex binary present', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'codex') return '/usr/bin/codex';
      if (cmd === 'codex') return 'ok';
      return '';
    });

    const lines = installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      // syncCodexCli defaults to true
    });

    expect(lines.some(l => l.includes('codex_cli_marketplace_add: ok'))).toBe(true);
    expect(lines.some(l => l.includes('codex_cli_plugin_add: ok'))).toBe(true);

    // Verify the actual shell-out commands issued
    const codexCalls = mockExecFileSync.mock.calls
      .filter((call: unknown[]) => call[0] === 'codex')
      .map((call: unknown[]) => (call[1] as string[]).join(' '));
    expect(codexCalls.some((s: string) => s.startsWith('plugin marketplace add '))).toBe(true);
    expect(codexCalls.some((s: string) => s === 'plugin add phone-a-friend@phone-a-friend-marketplace')).toBe(true);
  });

  it('syncCodexCli=true reports skipped when codex binary not in PATH', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'codex') {
        const err = new Error('not found') as NodeJS.ErrnoException & { status?: number };
        err.status = 1;
        throw err;
      }
      return '';
    });

    const lines = installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
    });

    expect(lines.some(l => l.includes('codex_cli: skipped'))).toBe(true);
  });

  it('codexCliUnsync=never skips the codex remove shell-out on uninstall', () => {
    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'codex') return '/usr/bin/codex';
      return '';
    });

    const lines = uninstallHosts({
      target: 'codex',
      codexHome,
      repoRoot: repo,
      codexCliUnsync: 'never',
    });

    expect(lines.some(l => l.includes('codex_cli_unsync: skipped'))).toBe(true);
    expect(lines.some(l => l.includes('codex_cli_plugin_remove'))).toBe(false);
  });

  it('uninstall fires codex plugin remove + marketplace remove when codex present', () => {
    installHosts({
      repoRoot: repo,
      target: 'codex',
      mode: 'symlink',
      force: false,
      codexHome,
      syncClaudeCli: false,
      syncCodexCli: false,
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'codex') return '/usr/bin/codex';
      if (cmd === 'codex') return 'removed';
      return '';
    });

    const lines = uninstallHosts({
      target: 'codex',
      codexHome,
      repoRoot: repo,
    });

    expect(lines.some(l => l.includes('codex_cli_plugin_remove: ok'))).toBe(true);
    expect(lines.some(l => l.includes('codex_cli_marketplace_remove: ok'))).toBe(true);
  });

  it('--all target installs Claude + OpenCode + Codex (with codex agents)', () => {
    const claudeHome = makeHome();
    const opencodeHome = makeHome();
    try {
      const lines = installHosts({
        repoRoot: repo,
        target: 'all',
        mode: 'symlink',
        force: false,
        claudeHome,
        opencodeHome,
        codexHome,
        syncClaudeCli: false,
        syncCodexCli: false,
      });

      // Claude plugin dir
      expect(fs.existsSync(path.join(claudeHome, 'plugins', 'phone-a-friend'))).toBe(true);
      // OpenCode skills + commands
      expect(fs.existsSync(opencodeSkillTarget('phone-a-friend', opencodeHome))).toBe(true);
      // Codex skills (no subagents — paf-* design was dropped)
      expect(fs.existsSync(codexSkillTarget('phone-a-team', codexHome))).toBe(true);
      expect(fs.existsSync(path.join(codexHome, 'agents'))).toBe(false);

      expect(lines.some(l => l.includes('codex_skill:phone-a-team'))).toBe(true);
    } finally {
      try { fs.rmSync(claudeHome, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(opencodeHome, { recursive: true, force: true }); } catch {}
    }
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

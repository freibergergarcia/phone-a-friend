import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installHosts, uninstallHosts, isPluginInstalled, isOpenCodeInstalled,
  isCodexInstalled, isPiInstalled, isGrokInstalled,
} from '../src/installer.js';

// Exercise actual packed content and filesystem operations, without registering
// anything in the user's host applications. Vendor marketplace commands have
// their own mocked failure/rollback coverage in installer.test.ts.
describe('packed npm artifact host installation', () => {
  let root: string;
  let repoRoot: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'paf-packed-install-'));
    const packed = JSON.parse(execFileSync('npm', [
      'pack', '--ignore-scripts', '--json', '--pack-destination', root,
    ], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 }));
    execFileSync('tar', ['-xzf', join(root, packed[0].filename), '-C', root]);
    repoRoot = join(root, 'package');
    expect(existsSync(join(repoRoot, 'node_modules'))).toBe(false);
    expect(existsSync(join(repoRoot, 'dist', 'index.js'))).toBe(true);
  }, 35_000);

  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it.each(['copy', 'symlink'] as const)('installs, updates, and uninstalls all five hosts using %s', mode => {
    const hosts = join(root, mode);
    mkdirSync(hosts);
    const homes = {
      claudeHome: join(hosts, 'claude'), opencodeHome: join(hosts, 'opencode'),
      codexHome: join(hosts, 'codex'), piHome: join(hosts, 'pi'),
      grokHome: join(hosts, 'grok'), pafHome: join(hosts, 'paf'),
    };
    const installed = () => [
      isPluginInstalled(homes.claudeHome), isOpenCodeInstalled(homes.opencodeHome),
      isCodexInstalled(homes.codexHome), isPiInstalled(homes.piHome), isGrokInstalled(homes.grokHome),
    ];
    expect(installed()).toEqual([false, false, false, false, false]);
    const opts = { repoRoot, target: 'all' as const, mode, ...homes, syncClaudeCli: false, syncCodexCli: false };
    installHosts(opts);
    expect(installed()).toEqual([true, true, true, true, true]);
    // Update uses a forced install, just as the CLI does. All source content is
    // from npm's allowlisted package, not the more permissive checkout layout.
    installHosts({ ...opts, force: true });
    expect(installed()).toEqual([true, true, true, true, true]);
    const codexSkill = readFileSync(join(homes.codexHome, 'skills', 'phone-a-friend', 'SKILL.md'), 'utf8');
    expect(codexSkill).toContain('PHONE_A_FRIEND_HOST=codex');
    expect(readFileSync(join(homes.opencodeHome, 'commands', 'phone-a-friend.md'), 'utf8')).toBe(
      readFileSync(join(repoRoot, 'skills', 'phone-a-friend', 'COMMAND.opencode.md'), 'utf8'),
    );
    uninstallHosts({ repoRoot, target: 'all', ...homes, claudeCliUnsync: 'never', codexCliUnsync: 'never' });
    expect(installed()).toEqual([false, false, false, false, false]);
  });
});

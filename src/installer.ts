/**
 * Install logic for Claude plugin integration.
 *
 * Ported from phone_a_friend/installer.py
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  cpSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { checkBackends, INSTALL_HINTS } from './backends/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLUGIN_NAME = 'phone-a-friend';
export const MARKETPLACE_NAME = 'phone-a-friend-marketplace';

/** Previous marketplace name; cleaned up during install/uninstall for existing users. */
const LEGACY_MARKETPLACE_NAME = 'phone-a-friend-dev';

/** GitHub repository for marketplace distribution. */
export const GITHUB_REPO = 'freibergergarcia/phone-a-friend';

const INSTALL_TARGETS = new Set(['claude', 'opencode', 'all']);
const INSTALL_MODES = new Set(['symlink', 'copy']);
const OPENCODE_SKILLS = ['phone-a-friend', 'curiosity-engine'] as const;

/**
 * Skills/commands that PaF previously installed for OpenCode but no longer
 * supports there. The installer removes any installed artifacts for these
 * names so existing users get a clean uninstall on their next
 * `plugin update --opencode`.
 *
 * `phone-a-team` was dropped because it relies on Claude Agent Teams
 * primitives (TeamCreate, Task, SendMessage, TeamDelete) that have no
 * OpenCode equivalent. The portable shell-based version we shipped for
 * OpenCode could not orchestrate reliably with smaller models. Claude
 * keeps the rich `commands/phone-a-team.md` runbook.
 */
const OPENCODE_LEGACY_SKILLS = ['phone-a-team'] as const;

type InstallTarget = 'claude' | 'opencode' | 'all';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InstallerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallerError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function removePath(filePath: string): void {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (stat.isSymbolicLink() || stat.isFile()) {
    unlinkSync(filePath);
  } else if (stat.isDirectory()) {
    rmSync(filePath, { recursive: true, force: true });
  }
}

function installPath(src: string, dst: string, mode: string, force: boolean): string {
  const dstExists = existsSync(dst) || isSymlink(dst);

  if (dstExists) {
    if (isSymlink(dst)) {
      // realpathSync throws on dangling symlinks — handle gracefully
      try {
        if (realpathSync(dst) === realpathSync(src)) {
          return 'already-installed';
        }
      } catch {
        // Dangling symlink — fall through to force/error handling
      }
    }
    if (!force) {
      throw new InstallerError(`Destination already exists: ${dst}`);
    }
    removePath(dst);
  }

  ensureParent(dst);
  if (mode === 'symlink') {
    symlinkSync(src, dst);
  } else {
    cpSync(src, dst, { recursive: true });
  }
  return 'installed';
}

function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function runClaudeCommand(args: string[]): { code: number; output: string } {
  try {
    const result = execFileSync(args[0], args.slice(1), {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, output: result.trim() };
  } catch (err: unknown) {
    const execErr = err as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    const stdout = execErr.stdout?.toString() ?? '';
    const stderr = execErr.stderr?.toString() ?? '';
    return {
      code: execErr.status ?? 1,
      output: (stdout + stderr).trim(),
    };
  }
}

function looksLikeOkIfAlready(output: string): boolean {
  const text = output.toLowerCase();
  return [
    'already configured',
    'already added',
    'already installed',
    'already enabled',
    'already up to date',
  ].some(token => text.includes(token));
}

function cleanupLegacyMarketplace(): string[] {
  const lines: string[] = [];

  try {
    execFileSync('which', ['claude'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return lines;
  }

  // Remove old plugin registration under the legacy marketplace name
  const commands: [string[], string][] = [
    [['claude', 'plugin', 'disable', `${PLUGIN_NAME}@${LEGACY_MARKETPLACE_NAME}`, '-s', 'user'], 'legacy_disable'],
    [['claude', 'plugin', 'uninstall', `${PLUGIN_NAME}@${LEGACY_MARKETPLACE_NAME}`, '-s', 'user'], 'legacy_uninstall'],
    [['claude', 'plugin', 'marketplace', 'remove', LEGACY_MARKETPLACE_NAME], 'legacy_marketplace_remove'],
  ];

  for (const [cmd, label] of commands) {
    const { code } = runClaudeCommand(cmd);
    if (code === 0) {
      lines.push(`- claude_cli_${label}: ok`);
    }
    // Silently ignore failures (legacy may not exist)
  }

  return lines;
}

function syncClaudePluginRegistration(
  source: string,
  marketplaceName: string = MARKETPLACE_NAME,
  pluginName: string = PLUGIN_NAME,
  scope: string = 'user',
): string[] {
  const lines: string[] = [];

  // Check if claude binary is available
  try {
    execFileSync('which', ['claude'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    lines.push('- claude_cli: skipped (claude binary not found)');
    return lines;
  }

  const commands: [string[], string][] = [
    [['claude', 'plugin', 'marketplace', 'add', source], 'marketplace_add'],
    [['claude', 'plugin', 'marketplace', 'update', marketplaceName], 'marketplace_update'],
    [['claude', 'plugin', 'install', `${pluginName}@${marketplaceName}`, '-s', scope], 'install'],
    [['claude', 'plugin', 'enable', `${pluginName}@${marketplaceName}`, '-s', scope], 'enable'],
    [['claude', 'plugin', 'update', `${pluginName}@${marketplaceName}`], 'update'],
  ];

  for (const [cmd, label] of commands) {
    const { code, output } = runClaudeCommand(cmd);
    if (code === 0 || looksLikeOkIfAlready(output)) {
      lines.push(`- claude_cli_${label}: ok`);
    } else {
      lines.push(`- claude_cli_${label}: failed`);
      if (output) {
        lines.push(`  output: ${output}`);
      }
    }
  }

  return lines;
}

function unsyncClaudePluginRegistration(
  marketplaceName: string = MARKETPLACE_NAME,
  pluginName: string = PLUGIN_NAME,
  _claudeHome?: string,
): string[] {
  // Note: _claudeHome is accepted for signature consistency with the guard
  // in uninstallHosts, but the `claude` CLI always uses its own default home.
  // A future version could use it for getMarketplaceSourceType checks here.
  const lines: string[] = [];

  try {
    execFileSync('which', ['claude'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    lines.push('- claude_cli: skipped (claude binary not found)');
    return lines;
  }

  // Unregister from current marketplace name
  const commands: [string[], string][] = [
    [['claude', 'plugin', 'disable', `${pluginName}@${marketplaceName}`, '-s', 'user'], 'disable'],
    [['claude', 'plugin', 'uninstall', `${pluginName}@${marketplaceName}`, '-s', 'user'], 'uninstall'],
    [['claude', 'plugin', 'marketplace', 'remove', marketplaceName], 'marketplace_remove'],
  ];

  for (const [cmd, label] of commands) {
    const { code, output } = runClaudeCommand(cmd);
    if (code === 0 || looksLikeOkIfAlready(output)) {
      lines.push(`- claude_cli_${label}: ok`);
    } else {
      lines.push(`- claude_cli_${label}: failed`);
      if (output) {
        lines.push(`  output: ${output}`);
      }
    }
  }

  // Also clean up legacy marketplace name if it exists
  if (marketplaceName !== LEGACY_MARKETPLACE_NAME) {
    const legacyCommands: [string[], string][] = [
      [['claude', 'plugin', 'disable', `${pluginName}@${LEGACY_MARKETPLACE_NAME}`, '-s', 'user'], 'legacy_disable'],
      [['claude', 'plugin', 'uninstall', `${pluginName}@${LEGACY_MARKETPLACE_NAME}`, '-s', 'user'], 'legacy_uninstall'],
      [['claude', 'plugin', 'marketplace', 'remove', LEGACY_MARKETPLACE_NAME], 'legacy_marketplace_remove'],
    ];
    for (const [cmd, label] of legacyCommands) {
      const { code, output } = runClaudeCommand(cmd);
      if (code === 0) {
        lines.push(`- claude_cli_${label}: ok`);
      }
      // Silently ignore failures for legacy cleanup
    }
  }

  return lines;
}

export function claudeTarget(claudeHome?: string): string {
  const base = claudeHome ?? join(homedir(), '.claude');
  return join(base, 'plugins', PLUGIN_NAME);
}

export function opencodeConfigRoot(opencodeHome?: string): string {
  if (opencodeHome) return opencodeHome;
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(xdgConfig, 'opencode');
}

export function opencodeSkillTarget(name: string, opencodeHome?: string): string {
  return join(opencodeConfigRoot(opencodeHome), 'skills', name);
}

export function opencodeCommandTarget(name: string, opencodeHome?: string): string {
  return join(opencodeConfigRoot(opencodeHome), 'commands', `${name}.md`);
}

/**
 * Resolve the OpenCode command source path for a skill.
 *
 * Per-skill overlay at `skills/<name>/COMMAND.opencode.md` wins when present,
 * otherwise falls back to the shared `commands/<name>.md`. The overlay lets a
 * skill ship a different command shim for OpenCode than the one Claude loads.
 */
export function opencodeCommandSource(repoRoot: string, name: string): string {
  const overlay = join(repoRoot, 'skills', name, 'COMMAND.opencode.md');
  if (existsSync(overlay)) return overlay;
  return join(repoRoot, 'commands', `${name}.md`);
}

/**
 * True when `target` is a symlink pointing somewhere inside this PaF repo.
 * Used to auto-replace stale PaF-owned symlinks when source paths change
 * (e.g. moving the OpenCode command shim from commands/ to skills/<name>/).
 */
function isStalePafSymlink(target: string, repoRoot: string): boolean {
  if (!isSymlink(target)) return false;
  try {
    const realTarget = realpathSync(target);
    const realRepo = realpathSync(repoRoot);
    return realTarget === realRepo || realTarget.startsWith(realRepo + sep);
  } catch {
    return false;
  }
}

export function isPluginInstalled(claudeHome?: string): boolean {
  const target = claudeTarget(claudeHome);
  // Check local symlink/copy install
  try {
    const resolved = realpathSync(target);
    if (existsSync(resolved)) return true;
  } catch {
    // Dangling symlink or missing path, fall through
  }
  if (existsSync(target)) return true;

  // Heuristic: check marketplace cache install.
  // This is best-effort. Cache presence after marketplace uninstall could
  // theoretically be a false positive, but in practice Claude Code removes
  // the cache directory on uninstall. The authoritative check would be
  // parsing `claude plugin list`, but that's too slow for a TUI status bar.
  const home = claudeHome ?? join(homedir(), '.claude');
  const cacheBase = join(home, 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME);
  try {
    return existsSync(cacheBase);
  } catch {
    return false;
  }
}

export function isOpenCodeInstalled(opencodeHome?: string): boolean {
  return OPENCODE_SKILLS.every((name) => (
    existsSync(join(opencodeSkillTarget(name, opencodeHome), 'SKILL.md')) &&
    existsSync(opencodeCommandTarget(name, opencodeHome))
  ));
}

function installClaude(
  repoRoot: string,
  mode: string,
  force: boolean,
  claudeHome?: string,
): { status: string; targetPath: string } {
  const target = claudeTarget(claudeHome);
  const status = installPath(repoRoot, target, mode, force);
  return { status, targetPath: target };
}

function installOpenCode(
  repoRoot: string,
  mode: string,
  force: boolean,
  opencodeHome?: string,
): string[] {
  const lines: string[] = [];

  // Auto-clean legacy artifacts before installing the active set, so users
  // who previously had a now-dropped skill (e.g. phone-a-team) don't keep
  // stale files in ~/.config/opencode/.
  for (const name of OPENCODE_LEGACY_SKILLS) {
    const skillTarget = opencodeSkillTarget(name, opencodeHome);
    const commandTarget = opencodeCommandTarget(name, opencodeHome);
    if (existsSync(skillTarget) || isSymlink(skillTarget)) {
      removePath(skillTarget);
      lines.push(`- opencode_skill:${name}: removed (legacy, no longer supported in OpenCode)`);
    }
    if (existsSync(commandTarget) || isSymlink(commandTarget)) {
      removePath(commandTarget);
      lines.push(`- opencode_command:${name}: removed (legacy, no longer supported in OpenCode)`);
    }
  }

  for (const name of OPENCODE_SKILLS) {
    const skillSource = join(repoRoot, 'skills', name);
    const commandSource = opencodeCommandSource(repoRoot, name);

    if (!existsSync(join(skillSource, 'SKILL.md'))) {
      throw new InstallerError(`Missing OpenCode skill source: ${join(skillSource, 'SKILL.md')}`);
    }
    if (!existsSync(commandSource)) {
      throw new InstallerError(`Missing OpenCode command source: ${commandSource}`);
    }

    const skillTarget = opencodeSkillTarget(name, opencodeHome);
    const skillForce = force || isStalePafSymlink(skillTarget, repoRoot);
    const skillStatus = installPath(skillSource, skillTarget, mode, skillForce);
    lines.push(`- opencode_skill:${name}: ${skillStatus} -> ${skillTarget}`);

    const commandTarget = opencodeCommandTarget(name, opencodeHome);
    const commandForce = force || isStalePafSymlink(commandTarget, repoRoot);
    const commandStatus = installPath(commandSource, commandTarget, mode, commandForce);
    lines.push(`- opencode_command:${name}: ${commandStatus} -> ${commandTarget}`);
  }

  return lines;
}

function uninstallPath(filePath: string): string {
  if (existsSync(filePath) || isSymlink(filePath)) {
    removePath(filePath);
    return 'removed';
  }
  return 'not-installed';
}

function uninstallClaude(claudeHome?: string): { status: string; targetPath: string } {
  const target = claudeTarget(claudeHome);
  return { status: uninstallPath(target), targetPath: target };
}

function uninstallOpenCode(opencodeHome?: string): string[] {
  const lines: string[] = [];
  // Remove the active set and any legacy artifacts together so a single
  // `plugin uninstall --opencode` leaves no PaF files behind.
  for (const name of [...OPENCODE_SKILLS, ...OPENCODE_LEGACY_SKILLS]) {
    const skillTarget = opencodeSkillTarget(name, opencodeHome);
    lines.push(`- opencode_skill:${name}: ${uninstallPath(skillTarget)}`);

    const commandTarget = opencodeCommandTarget(name, opencodeHome);
    lines.push(`- opencode_command:${name}: ${uninstallPath(commandTarget)}`);
  }
  return lines;
}

function isValidRepoRoot(repoRoot: string): boolean {
  return existsSync(join(repoRoot, '.claude-plugin', 'plugin.json'));
}

/**
 * Check if the marketplace is already registered with a remote (non-directory) source.
 * Returns the source type (e.g. "github", "git", "npm") if remote, or null if
 * local/directory or not registered.
 */
export function getMarketplaceSourceType(
  marketplaceName: string = MARKETPLACE_NAME,
  claudeHome?: string,
): string | null {
  const home = claudeHome ?? join(homedir(), '.claude');
  const registryPath = join(home, 'plugins', 'known_marketplaces.json');
  try {
    const data = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const entry = data[marketplaceName];
    if (!entry?.source?.source) return null;
    const sourceType = entry.source.source;
    // "directory" is a local source; everything else is remote
    return sourceType === 'directory' ? null : sourceType;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the plugin via GitHub marketplace (npm source).
 * Cleans up any existing local symlink, removes legacy marketplace,
 * and registers via the GitHub-hosted marketplace.
 */
export function installFromGitHubMarketplace(): string[] {
  const lines: string[] = [];
  // Only remove local symlink; skip marketplace unsync since we re-register immediately
  lines.push(...uninstallHosts({ target: 'claude', claudeCliUnsync: 'never' }));
  // Clean up legacy marketplace name
  lines.push(...cleanupLegacyMarketplace());
  // Register via GitHub marketplace
  lines.push(...syncClaudePluginRegistration(GITHUB_REPO));
  return lines;
}

export interface InstallOptions {
  repoRoot: string;
  target: InstallTarget;
  mode?: 'symlink' | 'copy';
  force?: boolean;
  claudeHome?: string;
  opencodeHome?: string;
  syncClaudeCli?: boolean;
  /** Force overwrite of a remote marketplace source with local path. */
  forceMarketplaceSync?: boolean;
}

export function installHosts(opts: InstallOptions): string[] {
  const {
    repoRoot,
    target,
    mode = 'symlink',
    force = false,
    claudeHome,
    opencodeHome,
    syncClaudeCli = true,
    forceMarketplaceSync = false,
  } = opts;

  if (!INSTALL_TARGETS.has(target)) {
    throw new InstallerError(`Invalid target: ${target}`);
  }
  if (!INSTALL_MODES.has(mode)) {
    throw new InstallerError(`Invalid mode: ${mode}`);
  }

  const resolvedRepo = resolve(repoRoot);
  if (!isValidRepoRoot(resolvedRepo)) {
    throw new InstallerError(`Invalid repo root: ${resolvedRepo}`);
  }

  const lines = [
    'phone-a-friend installer',
    `- repo_root: ${resolvedRepo}`,
    `- mode: ${mode}`,
  ];

  const shouldInstallClaude = target === 'claude' || target === 'all';
  const shouldInstallOpenCode = target === 'opencode' || target === 'all';

  if (shouldInstallClaude) {
    const { status, targetPath } = installClaude(resolvedRepo, mode, force, claudeHome);
    lines.push(`- claude: ${status} -> ${targetPath}`);
  }

  if (shouldInstallOpenCode) {
    lines.push(...installOpenCode(resolvedRepo, mode, force, opencodeHome));
  }

  if (shouldInstallClaude && syncClaudeCli) {
    // Guard: don't overwrite a remote marketplace source with a local path
    const remoteSource = getMarketplaceSourceType(MARKETPLACE_NAME, claudeHome);
    if (remoteSource && !forceMarketplaceSync) {
      lines.push(`- claude_cli_sync: skipped (marketplace already registered via ${remoteSource})`);
      lines.push(`  Use --force-marketplace-sync to overwrite, or --no-claude-cli-sync to skip.`);
    } else {
      lines.push(...cleanupLegacyMarketplace());
      lines.push(...syncClaudePluginRegistration(resolvedRepo));
    }
  }

  return lines;
}

export interface UninstallOptions {
  target: InstallTarget;
  claudeHome?: string;
  opencodeHome?: string;
  /**
   * Controls whether marketplace registration is removed during uninstall.
   * - 'auto' (default): skip unsync when marketplace has a remote source (github/npm/git),
   *   proceed when local/directory or not registered.
   * - 'always': unconditionally remove marketplace registration (--purge-marketplace).
   * - 'never': never unsync (used internally when re-registering immediately after).
   */
  claudeCliUnsync?: 'auto' | 'always' | 'never';
}

export function uninstallHosts(opts: UninstallOptions): string[] {
  const { target, claudeHome, opencodeHome, claudeCliUnsync = 'auto' } = opts;

  if (!INSTALL_TARGETS.has(target)) {
    throw new InstallerError(`Invalid target: ${target}`);
  }

  const lines = ['phone-a-friend uninstaller'];

  const shouldUninstallClaude = target === 'claude' || target === 'all';
  const shouldUninstallOpenCode = target === 'opencode' || target === 'all';

  if (shouldUninstallClaude) {
    const { status } = uninstallClaude(claudeHome);
    lines.push(`- claude: ${status}`);
  }

  if (shouldUninstallOpenCode) {
    lines.push(...uninstallOpenCode(opencodeHome));
  }

  if (!shouldUninstallClaude) {
    return lines;
  }

  if (claudeCliUnsync === 'never') {
    lines.push('- claude_cli_unsync: skipped');
    return lines;
  }

  if (claudeCliUnsync === 'auto') {
    const remoteSource = getMarketplaceSourceType(MARKETPLACE_NAME, claudeHome);
    if (remoteSource) {
      lines.push(`- claude_cli_unsync: skipped (marketplace registered via ${remoteSource})`);
      lines.push(`  Use --purge-marketplace to force removal.`);
      return lines;
    }
  }

  // 'always' or 'auto' with no remote source
  lines.push(...unsyncClaudePluginRegistration(MARKETPLACE_NAME, PLUGIN_NAME, claudeHome));

  return lines;
}

export interface BackendInfo {
  name: string;
  available: boolean;
  hint: string;
}

export function verifyBackends(): BackendInfo[] {
  const availability = checkBackends();
  return Object.entries(availability).map(([name, available]) => ({
    name,
    available,
    hint: INSTALL_HINTS[name] ?? '',
  }));
}

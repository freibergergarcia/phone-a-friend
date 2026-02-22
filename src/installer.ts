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
  realpathSync,
  rmSync,
  symlinkSync,
  cpSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { checkBackends, INSTALL_HINTS } from './backends/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLUGIN_NAME = 'phone-a-friend';
export const MARKETPLACE_NAME = 'phone-a-friend-dev';

const INSTALL_TARGETS = new Set(['claude', 'all']);
const INSTALL_MODES = new Set(['symlink', 'copy']);

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
    if (isSymlink(dst) && realpathSync(dst) === realpathSync(src)) {
      return 'already-installed';
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

function syncClaudePluginRegistration(
  repoRoot: string,
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
    [['claude', 'plugin', 'marketplace', 'add', repoRoot], 'marketplace_add'],
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

function claudeTarget(claudeHome?: string): string {
  const base = claudeHome ?? join(homedir(), '.claude');
  return join(base, 'plugins', PLUGIN_NAME);
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

function isValidRepoRoot(repoRoot: string): boolean {
  return existsSync(join(repoRoot, '.claude-plugin', 'plugin.json'));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InstallOptions {
  repoRoot: string;
  target: 'claude' | 'all';
  mode?: 'symlink' | 'copy';
  force?: boolean;
  claudeHome?: string;
  syncClaudeCli?: boolean;
}

export function installHosts(opts: InstallOptions): string[] {
  const {
    repoRoot,
    target,
    mode = 'symlink',
    force = false,
    claudeHome,
    syncClaudeCli = true,
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

  const { status, targetPath } = installClaude(resolvedRepo, mode, force, claudeHome);
  lines.push(`- claude: ${status} -> ${targetPath}`);

  if (syncClaudeCli) {
    lines.push(...syncClaudePluginRegistration(resolvedRepo));
  }

  return lines;
}

export interface UninstallOptions {
  target: 'claude' | 'all';
  claudeHome?: string;
}

export function uninstallHosts(opts: UninstallOptions): string[] {
  const { target, claudeHome } = opts;

  if (!INSTALL_TARGETS.has(target)) {
    throw new InstallerError(`Invalid target: ${target}`);
  }

  const lines = ['phone-a-friend uninstaller'];

  const { status, targetPath } = uninstallClaude(claudeHome);
  lines.push(`- claude: ${status} -> ${targetPath}`);

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

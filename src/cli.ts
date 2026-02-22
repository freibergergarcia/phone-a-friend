/**
 * CLI entry point using Commander.js.
 *
 * Ported from phone_a_friend/cli.py
 */

import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  relay,
  RelayError,
  DEFAULT_BACKEND,
  DEFAULT_SANDBOX,
  DEFAULT_TIMEOUT_SECONDS,
} from './relay.js';
import {
  installHosts,
  uninstallHosts,
  verifyBackends,
  InstallerError,
} from './installer.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

function getVersion(): string {
  // Read version from package.json relative to this file
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(thisDir, '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Repo root default
// ---------------------------------------------------------------------------

function repoRootDefault(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, '..');
}

// ---------------------------------------------------------------------------
// Argv normalization (backward compatibility)
// ---------------------------------------------------------------------------

function normalizeArgv(argv: string[]): string[] {
  if (argv.length === 0) return argv;
  const first = argv[0];
  if (['relay', 'install', 'update', 'uninstall', '-h', '--help', '--version'].includes(first)) {
    return argv;
  }
  if (first.startsWith('-')) {
    return ['relay', ...argv];
  }
  return argv;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printBackendAvailability(): void {
  console.log('\nBackend availability:');
  for (const info of verifyBackends()) {
    const mark = info.available ? '\u2713' : '\u2717';
    const status = info.available ? 'available' : 'not found';
    console.log(`  ${mark} ${info.name}: ${status}`);
    if (!info.available && info.hint) {
      console.log(`    Install: ${info.hint}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

interface RelayArgs {
  to: string;
  repo: string;
  prompt: string;
  contextFile: string | null;
  contextText: string | null;
  includeDiff: boolean;
  timeout: number;
  model: string | null;
  sandbox: string;
}

function handleRelay(args: RelayArgs): number {
  const feedback = relay({
    prompt: args.prompt,
    repoPath: args.repo,
    backend: args.to,
    contextFile: args.contextFile,
    contextText: args.contextText,
    includeDiff: args.includeDiff,
    timeoutSeconds: args.timeout,
    model: args.model,
    sandbox: args.sandbox as 'read-only' | 'workspace-write' | 'danger-full-access',
  });
  console.log(feedback);
  return 0;
}

interface InstallArgs {
  claude: boolean;
  all: boolean;
  mode: string;
  force: boolean;
  repoRoot: string;
  noClaudeCliSync: boolean;
}

function handleInstall(args: InstallArgs): number {
  const target = args.all ? 'all' : 'claude';
  const lines = installHosts({
    repoRoot: args.repoRoot,
    target: target as 'claude' | 'all',
    mode: args.mode as 'symlink' | 'copy',
    force: args.force,
    syncClaudeCli: !args.noClaudeCliSync,
  });
  for (const line of lines) console.log(line);
  printBackendAvailability();
  return 0;
}

function handleUpdate(args: { mode: string; repoRoot: string; noClaudeCliSync: boolean }): number {
  return handleInstall({
    claude: true,
    all: false,
    mode: args.mode,
    force: true,
    repoRoot: args.repoRoot,
    noClaudeCliSync: args.noClaudeCliSync,
  });
}

function handleUninstall(args: { claude: boolean; all: boolean }): number {
  const target = args.all ? 'all' : 'claude';
  const lines = uninstallHosts({ target: target as 'claude' | 'all' });
  for (const line of lines) console.log(line);
  return 0;
}

// ---------------------------------------------------------------------------
// Minimal command parser (no dependency needed for simple subcommand routing)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { command: string; opts: Record<string, string | boolean | null> } {
  const opts: Record<string, string | boolean | null> = {};
  let command = '';
  let i = 0;

  // First non-flag arg is the command
  if (argv.length > 0 && !argv[0].startsWith('-')) {
    command = argv[0];
    i = 1;
  }

  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      // Check if this is a boolean flag or has a value
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        opts[name] = argv[i + 1];
        i += 2;
      } else {
        opts[name] = true;
        i += 1;
      }
    } else {
      i += 1;
    }
  }

  return { command, opts };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function run(argv: string[]): number {
  // Handle --version before normalization
  if (argv.includes('--version')) {
    console.log(`phone-a-friend ${getVersion()}`);
    return 0;
  }

  // Handle --help
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }

  const normalized = normalizeArgv(argv);
  const { command, opts } = parseArgs(normalized);

  try {
    switch (command) {
      case 'relay':
        return handleRelay({
          to: String(opts['to'] ?? DEFAULT_BACKEND),
          repo: String(opts['repo'] ?? process.cwd()),
          prompt: String(opts['prompt'] ?? ''),
          contextFile: opts['context-file'] != null ? String(opts['context-file']) : null,
          contextText: opts['context-text'] != null ? String(opts['context-text']) : null,
          includeDiff: opts['include-diff'] === true,
          timeout: opts['timeout'] != null ? Number(opts['timeout']) : DEFAULT_TIMEOUT_SECONDS,
          model: opts['model'] != null ? String(opts['model']) : null,
          sandbox: String(opts['sandbox'] ?? DEFAULT_SANDBOX),
        });

      case 'install':
        return handleInstall({
          claude: opts['claude'] === true,
          all: opts['all'] === true,
          mode: String(opts['mode'] ?? 'symlink'),
          force: opts['force'] === true,
          repoRoot: String(opts['repo-root'] ?? repoRootDefault()),
          noClaudeCliSync: opts['no-claude-cli-sync'] === true,
        });

      case 'update':
        return handleUpdate({
          mode: String(opts['mode'] ?? 'symlink'),
          repoRoot: String(opts['repo-root'] ?? repoRootDefault()),
          noClaudeCliSync: opts['no-claude-cli-sync'] === true,
        });

      case 'uninstall':
        return handleUninstall({
          claude: opts['claude'] === true,
          all: opts['all'] === true,
        });

      default:
        printHelp();
        return 1;
    }
  } catch (err) {
    if (err instanceof RelayError || err instanceof InstallerError) {
      console.error(String(err.message));
      return 1;
    }
    if (err instanceof Error) {
      console.error(String(err.message));
      return 1;
    }
    throw err;
  }
}

function printHelp(): void {
  console.log(`phone-a-friend - CLI relay for AI coding agent collaboration

Usage:
  phone-a-friend relay --prompt "..." [options]
  phone-a-friend install --claude [options]
  phone-a-friend update [options]
  phone-a-friend uninstall --claude

Commands:
  relay       Relay prompt/context to a coding backend (default)
  install     Install Claude plugin
  update      Update Claude plugin (equivalent to install --force)
  uninstall   Uninstall Claude plugin

Relay options:
  --to <backend>           Target backend: codex, gemini (default: codex)
  --repo <path>            Repository path (default: cwd)
  --prompt <text>          Prompt to relay (required)
  --context-file <path>    File with additional context
  --context-text <text>    Inline context text
  --include-diff           Append git diff to prompt
  --timeout <seconds>      Max runtime in seconds (default: 600)
  --model <name>           Model override
  --sandbox <mode>         Sandbox: read-only, workspace-write, danger-full-access

Install options:
  --claude                 Install for Claude
  --all                    Alias for --claude
  --mode <mode>            symlink or copy (default: symlink)
  --force                  Replace existing installation
  --repo-root <path>       Repository root path
  --no-claude-cli-sync     Skip Claude CLI sync

General:
  --version                Show version
  --help, -h               Show this help
`);
}

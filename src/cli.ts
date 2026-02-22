/**
 * CLI entry point using Commander.js.
 *
 * Ported from phone_a_friend/cli.py
 */

import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
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
  if (['relay', 'install', 'update', 'uninstall'].includes(first)) {
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
// Public API
// ---------------------------------------------------------------------------

export function run(argv: string[]): number {
  const normalized = normalizeArgv(argv);
  let exitCode = 0;

  const program = new Command()
    .name('phone-a-friend')
    .version(`phone-a-friend ${getVersion()}`, '-V, --version')
    .description('CLI relay for AI coding agent collaboration')
    .configureOutput({
      writeOut: (str) => console.log(str.trimEnd()),
      writeErr: (str) => console.error(str.trimEnd()),
    })
    .exitOverride(); // Don't call process.exit — let us control exit codes

  // --- relay subcommand ---
  program
    .command('relay')
    .description('Relay prompt/context to a coding backend (default)')
    .requiredOption('--prompt <text>', 'Prompt to relay')
    .option('--to <backend>', 'Target backend: codex, gemini', DEFAULT_BACKEND)
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--context-file <path>', 'File with additional context')
    .option('--context-text <text>', 'Inline context text')
    .option('--include-diff', 'Append git diff to prompt', false)
    .option('--timeout <seconds>', 'Max runtime in seconds', String(DEFAULT_TIMEOUT_SECONDS))
    .option('--model <name>', 'Model override')
    .option('--sandbox <mode>', 'Sandbox: read-only, workspace-write, danger-full-access', DEFAULT_SANDBOX)
    .action((opts) => {
      const feedback = relay({
        prompt: opts.prompt,
        repoPath: opts.repo,
        backend: opts.to,
        contextFile: opts.contextFile ?? null,
        contextText: opts.contextText ?? null,
        includeDiff: opts.includeDiff,
        timeoutSeconds: Number(opts.timeout),
        model: opts.model ?? null,
        sandbox: opts.sandbox,
      });
      console.log(feedback);
    });

  // --- install subcommand ---
  program
    .command('install')
    .description('Install Claude plugin')
    .option('--claude', 'Install for Claude', false)
    .option('--all', 'Alias for --claude', false)
    .option('--mode <mode>', 'Installation mode: symlink or copy', 'symlink')
    .option('--force', 'Replace existing installation', false)
    .option('--repo-root <path>', 'Repository root path', repoRootDefault())
    .option('--no-claude-cli-sync', 'Skip Claude CLI sync')
    .action((opts) => {
      const target = opts.all ? 'all' : 'claude';
      const lines = installHosts({
        repoRoot: opts.repoRoot,
        target: target as 'claude' | 'all',
        mode: opts.mode as 'symlink' | 'copy',
        force: opts.force,
        syncClaudeCli: opts.claudeCliSync !== false,
      });
      for (const line of lines) console.log(line);
      printBackendAvailability();
    });

  // --- update subcommand ---
  program
    .command('update')
    .description('Update Claude plugin (equivalent to install --force)')
    .option('--mode <mode>', 'Installation mode: symlink or copy', 'symlink')
    .option('--repo-root <path>', 'Repository root path', repoRootDefault())
    .option('--no-claude-cli-sync', 'Skip Claude CLI sync')
    .action((opts) => {
      const lines = installHosts({
        repoRoot: opts.repoRoot,
        target: 'claude',
        mode: opts.mode as 'symlink' | 'copy',
        force: true,
        syncClaudeCli: opts.claudeCliSync !== false,
      });
      for (const line of lines) console.log(line);
      printBackendAvailability();
    });

  // --- uninstall subcommand ---
  program
    .command('uninstall')
    .description('Uninstall Claude plugin')
    .option('--claude', 'Uninstall for Claude', false)
    .option('--all', 'Alias for --claude', false)
    .action((opts) => {
      const target = opts.all ? 'all' : 'claude';
      const lines = uninstallHosts({ target: target as 'claude' | 'all' });
      for (const line of lines) console.log(line);
    });

  try {
    program.parse(normalized, { from: 'user' });
  } catch (err) {
    if (err instanceof RelayError || err instanceof InstallerError) {
      console.error(err.message);
      return 1;
    }
    // Commander throws CommanderError for --help, --version, parse errors
    if (err && typeof err === 'object' && 'exitCode' in err) {
      return (err as { exitCode: number }).exitCode;
    }
    if (err instanceof Error) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  return exitCode;
}

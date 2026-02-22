/**
 * CLI entry point using Commander.js.
 *
 * Subcommands: relay (default), setup, doctor, config, plugin
 * Backward compat aliases: install, update, uninstall
 */

import { resolve, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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
import { setup } from './setup.js';
import { doctor } from './doctor.js';
import {
  configInit,
  configPaths,
  configGet,
  configSet,
  loadConfig,
  DEFAULT_CONFIG,
} from './config.js';

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

const KNOWN_SUBCOMMANDS = ['relay', 'install', 'update', 'uninstall', 'setup', 'doctor', 'config', 'plugin'];

function normalizeArgv(argv: string[]): string[] {
  if (argv.length === 0) return argv;
  const first = argv[0];
  if (KNOWN_SUBCOMMANDS.includes(first)) {
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
// Install/update/uninstall action factories (shared by plugin + backward compat)
// ---------------------------------------------------------------------------

function installAction(opts: {
  claude?: boolean;
  all?: boolean;
  mode?: string;
  force?: boolean;
  repoRoot?: string;
  claudeCliSync?: boolean;
}): void {
  const target = opts.all ? 'all' : 'claude';
  const lines = installHosts({
    repoRoot: opts.repoRoot ?? repoRootDefault(),
    target: target as 'claude' | 'all',
    mode: (opts.mode ?? 'symlink') as 'symlink' | 'copy',
    force: opts.force ?? false,
    syncClaudeCli: opts.claudeCliSync !== false,
  });
  for (const line of lines) console.log(line);
  printBackendAvailability();
}

function updateAction(opts: {
  mode?: string;
  repoRoot?: string;
  claudeCliSync?: boolean;
}): void {
  const lines = installHosts({
    repoRoot: opts.repoRoot ?? repoRootDefault(),
    target: 'claude',
    mode: (opts.mode ?? 'symlink') as 'symlink' | 'copy',
    force: true,
    syncClaudeCli: opts.claudeCliSync !== false,
  });
  for (const line of lines) console.log(line);
  printBackendAvailability();
}

function uninstallAction(opts: { claude?: boolean; all?: boolean }): void {
  const target = opts.all ? 'all' : 'claude';
  const lines = uninstallHosts({ target: target as 'claude' | 'all' });
  for (const line of lines) console.log(line);
}

// ---------------------------------------------------------------------------
// Install/update/uninstall option helpers
// ---------------------------------------------------------------------------

function addInstallOptions(cmd: Command): Command {
  return cmd
    .option('--claude', 'Install for Claude', false)
    .option('--all', 'Alias for --claude', false)
    .option('--mode <mode>', 'Installation mode: symlink or copy', 'symlink')
    .option('--force', 'Replace existing installation', false)
    .option('--repo-root <path>', 'Repository root path')
    .option('--no-claude-cli-sync', 'Skip Claude CLI sync');
}

function addUpdateOptions(cmd: Command): Command {
  return cmd
    .option('--mode <mode>', 'Installation mode: symlink or copy', 'symlink')
    .option('--repo-root <path>', 'Repository root path')
    .option('--no-claude-cli-sync', 'Skip Claude CLI sync');
}

function addUninstallOptions(cmd: Command): Command {
  return cmd
    .option('--claude', 'Uninstall for Claude', false)
    .option('--all', 'Alias for --claude', false);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function run(argv: string[]): Promise<number> {
  const normalized = normalizeArgv(argv);
  let exitCode = 0;

  // Smart no-args behavior
  if (normalized.length === 0) {
    const paths = configPaths();
    if (!existsSync(paths.user)) {
      // No config — show setup nudge
      const version = getVersion();
      console.log('');
      console.log(`  phone-a-friend v${version} \u2014 AI coding agent relay`);
      console.log('');
      console.log('  No backends configured yet. Run setup to get started:');
      console.log('');
      console.log('    phone-a-friend setup');
      console.log('');
      console.log('  Or jump straight in (requires codex in PATH):');
      console.log('');
      console.log('    phone-a-friend --to codex --prompt "What does this project do?"');
      console.log('');
      return 0;
    }
    // Config exists — fall through to Commander help
  }

  const program = new Command()
    .name('phone-a-friend')
    .version(`phone-a-friend ${getVersion()}`, '-V, --version')
    .description('CLI relay for AI coding agent collaboration')
    .configureOutput({
      writeOut: (str) => console.log(str.trimEnd()),
      writeErr: (str) => console.error(str.trimEnd()),
    })
    .exitOverride();

  // --- relay subcommand ---
  program
    .command('relay')
    .description('Relay prompt/context to a coding backend (default)')
    .requiredOption('--prompt <text>', 'Prompt to relay')
    .option('--to <backend>', 'Target backend: codex, gemini, ollama, openai', DEFAULT_BACKEND)
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

  // --- setup subcommand ---
  program
    .command('setup')
    .description('Interactive setup wizard')
    .action(async () => {
      await setup();
    });

  // --- doctor subcommand ---
  program
    .command('doctor')
    .description('Health check all backends')
    .option('--json', 'Output structured JSON', false)
    .action(async (opts) => {
      const result = await doctor({ json: opts.json });
      console.log(result.output);
      exitCode = result.exitCode;
    });

  // --- config subcommand group ---
  const configCmd = program
    .command('config')
    .description('Manage configuration');

  configCmd
    .command('init')
    .description('Create default config file')
    .action(() => {
      const paths = configPaths();
      configInit(paths.user);
      console.log(`Config created at ${paths.user}`);
    });

  configCmd
    .command('show')
    .description('Show resolved configuration')
    .option('--sources', 'Show which file each value comes from', false)
    .action((opts) => {
      const config = loadConfig();
      if (opts.sources) {
        const paths = configPaths();
        console.log(`User config: ${paths.user}`);
        if (paths.repo) console.log(`Repo config: ${paths.repo}`);
        console.log('');
      }
      console.log(JSON.stringify(config, null, 2));
    });

  configCmd
    .command('paths')
    .description('Print all config file paths')
    .action(() => {
      const paths = configPaths();
      console.log(`User: ${paths.user}`);
      if (paths.repo) {
        console.log(`Repo: ${paths.repo}`);
      } else {
        console.log('Repo: (none)');
      }
    });

  configCmd
    .command('edit')
    .description('Open user config in $EDITOR')
    .action(() => {
      const paths = configPaths();
      const editor = process.env.EDITOR ?? 'vi';
      if (!existsSync(paths.user)) {
        configInit(paths.user);
      }
      spawnSync(editor, [paths.user], { stdio: 'inherit' });
    });

  configCmd
    .command('set <key> <value>')
    .description('Set a config value (dot-notation)')
    .action((key: string, value: string) => {
      const paths = configPaths();
      if (!existsSync(paths.user)) {
        configInit(paths.user);
      }
      configSet(key, value, paths.user);
      console.log(`Set ${key} = ${value}`);
    });

  configCmd
    .command('get <key>')
    .description('Get a config value')
    .action((key: string) => {
      const config = loadConfig();
      const value = configGet(key, config);
      if (value === undefined) {
        console.log(`(not set)`);
      } else {
        console.log(String(value));
      }
    });

  // --- plugin subcommand group ---
  const pluginCmd = program
    .command('plugin')
    .description('Manage host integrations');

  addInstallOptions(
    pluginCmd
      .command('install')
      .description('Install as Claude Code plugin')
  ).action((opts) => installAction(opts));

  addUpdateOptions(
    pluginCmd
      .command('update')
      .description('Update Claude plugin')
  ).action((opts) => updateAction(opts));

  addUninstallOptions(
    pluginCmd
      .command('uninstall')
      .description('Uninstall Claude plugin')
  ).action((opts) => uninstallAction(opts));

  // --- Backward compat aliases ---
  addInstallOptions(
    program
      .command('install')
      .description('Install Claude plugin (alias for: plugin install)')
  ).action((opts) => installAction(opts));

  addUpdateOptions(
    program
      .command('update')
      .description('Update Claude plugin (alias for: plugin update)')
  ).action((opts) => updateAction(opts));

  addUninstallOptions(
    program
      .command('uninstall')
      .description('Uninstall Claude plugin (alias for: plugin uninstall)')
  ).action((opts) => uninstallAction(opts));

  try {
    await program.parseAsync(normalized, { from: 'user' });
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

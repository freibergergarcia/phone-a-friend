/**
 * CLI entry point using Commander.js.
 *
 * Subcommands: relay (default), setup, doctor, config, plugin
 * Backward compat aliases: install, update, uninstall
 */

import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import ora from 'ora';
import {
  relay,
  relayStream,
  reviewRelay,
  RelayError,
} from './relay.js';
import { theme, banner } from './theme.js';
import type { SandboxMode } from './backends/index.js';
import {
  installHosts,
  uninstallHosts,
  verifyBackends,
  isPluginInstalled,
  installFromGitHubMarketplace,
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
  resolveConfig,
  DEFAULT_CONFIG,
} from './config.js';
import { getVersion, getPackageRoot } from './version.js';

// ---------------------------------------------------------------------------
// Repo root default
// ---------------------------------------------------------------------------

function repoRootDefault(): string {
  return getPackageRoot();
}

// ---------------------------------------------------------------------------
// Argv normalization (backward compatibility)
// ---------------------------------------------------------------------------

const KNOWN_SUBCOMMANDS = ['relay', 'install', 'update', 'uninstall', 'setup', 'doctor', 'config', 'plugin', 'agentic'];

// Flags that Commander handles at the top level — never auto-route to relay
const TOP_LEVEL_FLAGS = new Set(['-v', '-V', '--version', '-h', '--help']);

function normalizeArgv(argv: string[]): string[] {
  if (argv.length === 0) return argv;
  const first = argv[0];
  if (KNOWN_SUBCOMMANDS.includes(first)) {
    return argv;
  }
  // Don't auto-route --help / --version to relay
  if (TOP_LEVEL_FLAGS.has(first)) {
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
  github?: boolean;
}): void {
  if (opts.github) {
    // Reject flags that don't apply to marketplace install
    if (opts.mode && opts.mode !== 'symlink') {
      console.error('Error: --mode is not compatible with --github');
      process.exitCode = 1;
      return;
    }
    if (opts.repoRoot) {
      console.error('Error: --repo-root is not compatible with --github');
      process.exitCode = 1;
      return;
    }
    // GitHub marketplace flow
    const lines = ['phone-a-friend installer (GitHub marketplace)'];
    lines.push(...installFromGitHubMarketplace());
    for (const line of lines) console.log(line);
    printBackendAvailability();
    return;
  }
  // Existing local install flow
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
    .option('--no-claude-cli-sync', 'Skip Claude CLI sync')
    .option('--github', 'Use GitHub marketplace (npm source) instead of local symlink');
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
    const isFirstRun = !existsSync(paths.user);
    const isTTY = process.stdout.isTTY && process.env.TERM !== 'dumb';

    if (isTTY && isFirstRun) {
      // First-run interactive menu
      const { select } = await import('@inquirer/prompts');
      console.log('');
      console.log(banner('AI coding agent relay'));
      console.log('');
      console.log(`  ${theme.heading('Welcome!')} No configuration found yet.`);
      console.log('');

      const choice = await select({
        message: 'What would you like to do?',
        choices: [
          { name: 'Run setup wizard (recommended)', value: 'setup' },
          { name: 'Show quick start examples', value: 'quickstart' },
          { name: 'Open TUI dashboard', value: 'tui' },
          { name: 'Exit', value: 'exit' },
        ],
      });

      if (choice === 'setup') {
        await setup();
        return 0;
      }
      if (choice === 'quickstart') {
        console.log('');
        console.log(`  ${theme.heading('Quick start')}`);
        console.log('');
        console.log(`  ${theme.hint('Relay a prompt to a backend:')}`);
        console.log(`    ${theme.info('phone-a-friend --to codex --prompt "What does this project do?"')}`);
        console.log('');
        console.log(`  ${theme.hint('Stream tokens as they arrive:')}`);
        console.log(`    ${theme.info('phone-a-friend --to claude --prompt "Review this code" --stream')}`);
        console.log('');
        console.log(`  ${theme.hint('Multi-agent session:')}`);
        console.log(`    ${theme.info('phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "Review auth"')}`);
        console.log('');
        console.log(`  ${theme.hint('Run setup anytime:')} ${theme.info('phone-a-friend setup')}`);
        console.log('');
        return 0;
      }
      if (choice === 'tui') {
        const { renderTui } = await import('./tui/render.js');
        return await renderTui();
      }
      // exit
      return 0;
    }

    if (isTTY) {
      // Config exists but plugin not installed: offer to reinstall
      if (!isPluginInstalled()) {
        const { select } = await import('@inquirer/prompts');
        console.log('');
        console.log(banner('AI coding agent relay'));
        console.log('');
        console.log(`  ${theme.warning('Claude plugin is not installed.')}`);
        console.log('');

        const choice = await select({
          message: 'What would you like to do?',
          choices: [
            { name: 'Run setup wizard (installs plugin + configures backend)', value: 'setup' },
            { name: 'Install plugin only', value: 'install' },
            { name: 'Open TUI dashboard', value: 'tui' },
            { name: 'Exit', value: 'exit' },
          ],
        });

        if (choice === 'setup') {
          await setup();
          return 0;
        }
        if (choice === 'install') {
          installAction({ claude: true, force: true });
          return 0;
        }
        if (choice === 'tui') {
          const { renderTui } = await import('./tui/render.js');
          return await renderTui();
        }
        return 0;
      }

      // Config exists + plugin installed: launch TUI directly
      const { renderTui } = await import('./tui/render.js');
      return await renderTui();
    }

    // Non-interactive: show setup nudge or help
    if (isFirstRun) {
      console.log('');
      console.log(banner('AI coding agent relay'));
      console.log('');
      console.log(`  ${theme.warning('No backends configured yet.')}`);
      console.log(`  Run ${theme.bold('phone-a-friend setup')} to get started.`);
      console.log('');
      console.log(`  ${theme.hint('Or jump straight in (requires codex in PATH):')}`);
      console.log(`    ${theme.info('phone-a-friend --to codex --prompt "What does this project do?"')}`);
      console.log('');
      return 0;
    }
    // Config exists, non-TTY: fall through to Commander help
  }

  const program = new Command()
    .name('phone-a-friend')
    .version(`phone-a-friend ${getVersion()}`, '-v, --version')
    .description('CLI relay for AI coding agent collaboration')
    .addHelpText('before', `\n${banner('AI coding agent relay')}\n`)
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
    .option('--to <backend>', 'Target backend: codex, gemini, ollama, claude')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--context-file <path>', 'File with additional context')
    .option('--context-text <text>', 'Inline context text')
    .option('--include-diff', 'Append git diff to prompt')
    .option('--timeout <seconds>', 'Max runtime in seconds')
    .option('--model <name>', 'Model override')
    .option('--sandbox <mode>', 'Sandbox: read-only, workspace-write, danger-full-access')
    .option('--no-stream', 'Disable streaming output (get full response at once)')
    .option('--review', 'Use review mode (scoped to diff against base branch)')
    .option('--base <branch>', 'Base branch for review diff (default: auto-detect main/master)')
    .action(async (opts, command) => {
      // --base without --review implies review mode
      const isReview = opts.review || opts.base !== undefined;

      // Only pass stream to config resolution when user explicitly passed --no-stream.
      // Commander's --no-stream sets opts.stream to true (default) or false (flag passed),
      // so opts.stream is never undefined — we must check the option value source.
      const streamExplicit = command.getOptionValueSource('stream') === 'cli';

      // Resolve config: CLI flags > env vars > repo config > user config > defaults
      const resolved = resolveConfig({
        to: opts.to,
        sandbox: opts.sandbox,
        timeout: opts.timeout,
        includeDiff: opts.includeDiff !== undefined ? String(opts.includeDiff) : undefined,
        stream: streamExplicit ? String(opts.stream) : undefined,
        model: opts.model,
        base: opts.base,
      });

      const backendName = resolved.backend;

      if (isReview) {
        const baseLabel = opts.base ?? resolved.reviewBase ?? 'auto-detect';
        const spinner = ora({
          text: `Reviewing against ${theme.bold(baseLabel)} via ${theme.bold(backendName)}...`,
          spinner: 'dots',
          color: 'cyan',
          stream: process.stderr,
        }).start();

        try {
          const feedback = await reviewRelay({
            repoPath: opts.repo,
            backend: backendName,
            base: opts.base ?? resolved.reviewBase,
            prompt: opts.prompt,
            timeoutSeconds: resolved.timeout,
            model: resolved.model ?? null,
            sandbox: resolved.sandbox as SandboxMode,
          });
          spinner.succeed(`${theme.bold(backendName)} reviewed`);
          process.stdout.write(feedback + '\n');
        } catch (err) {
          spinner.fail(`${theme.bold(backendName)} review failed`);
          throw err;
        }
        return;
      }

      const relayOpts = {
        prompt: opts.prompt,
        repoPath: opts.repo,
        backend: backendName,
        contextFile: opts.contextFile ?? null,
        contextText: opts.contextText ?? null,
        includeDiff: resolved.includeDiff,
        timeoutSeconds: resolved.timeout,
        model: resolved.model ?? null,
        sandbox: resolved.sandbox as SandboxMode,
      };

      if (resolved.stream) {
        const spinner = ora({
          text: `Relaying to ${theme.bold(backendName)}...`,
          spinner: 'dots',
          color: 'cyan',
          stream: process.stderr,
        }).start();

        let firstChunk = true;
        let hasOutput = false;
        try {
          for await (const chunk of relayStream(relayOpts)) {
            if (firstChunk) {
              spinner.stop();
              firstChunk = false;
            }
            process.stdout.write(chunk);
            hasOutput = true;
          }
          if (hasOutput) {
            process.stdout.write('\n');
          }
          process.stderr.write(`  ${theme.checkmark} ${theme.bold(backendName)} responded\n`);
        } catch (err) {
          if (firstChunk) {
            spinner.fail(`${theme.bold(backendName)} failed`);
          } else {
            process.stderr.write(`\n  ${theme.crossmark} ${theme.error(`${backendName} stream error`)}\n`);
          }
          throw err;
        }
      } else {
        const spinner = ora({
          text: `Relaying to ${theme.bold(backendName)}...`,
          spinner: 'dots',
          color: 'cyan',
          stream: process.stderr,
        }).start();

        try {
          const feedback = await relay(relayOpts);
          spinner.succeed(`${theme.bold(backendName)} responded`);
          process.stdout.write(feedback + '\n');
        } catch (err) {
          spinner.fail(`${theme.bold(backendName)} failed`);
          throw err;
        }
      }
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
      const result = await doctor({ json: opts.json, repoRoot: process.cwd() });
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
    .option('--force', 'Overwrite existing config', false)
    .action((opts) => {
      const paths = configPaths(process.cwd());
      configInit(paths.user, opts.force);
      console.log(`Config created at ${paths.user}`);
    });

  configCmd
    .command('show')
    .description('Show resolved configuration')
    .option('--sources', 'Show which file each value comes from', false)
    .action((opts) => {
      const config = loadConfig(process.cwd());
      if (opts.sources) {
        const paths = configPaths(process.cwd());
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
      const paths = configPaths(process.cwd());
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
      const paths = configPaths(process.cwd());
      const editorEnv = process.env.EDITOR ?? 'vi';
      if (!existsSync(paths.user)) {
        configInit(paths.user, true);
      }
      // Handle editors with args (e.g. "code -w", "nvim -u ...")
      const parts = editorEnv.split(/\s+/);
      spawnSync(parts[0], [...parts.slice(1), paths.user], { stdio: 'inherit' });
    });

  configCmd
    .command('set <key> <value>')
    .description('Set a config value (dot-notation)')
    .action((key: string, value: string) => {
      const paths = configPaths(process.cwd());
      if (!existsSync(paths.user)) {
        configInit(paths.user, true);
      }
      configSet(key, value, paths.user);
      console.log(`Set ${key} = ${value}`);
    });

  configCmd
    .command('get <key>')
    .description('Get a config value')
    .action((key: string) => {
      const config = loadConfig(process.cwd());
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

  // --- agentic subcommand group ---
  const agenticCmd = program
    .command('agentic')
    .description('Multi-agent sessions with persistent agent-to-agent communication');

  agenticCmd
    .command('run', { isDefault: true })
    .description('Start an agentic session')
    .requiredOption('--agents <list>', 'Agent definitions: role:backend,... (e.g. security:claude,perf:claude)')
    .requiredOption('--prompt <text>', 'Task prompt for the agents')
    .option('--max-turns <n>', 'Maximum turns before forced stop', '20')
    .option('--timeout <seconds>', 'Session timeout in seconds', '900')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--sandbox <mode>', 'Sandbox mode', 'read-only')
    .option('--dashboard-url <url>', 'Dashboard URL for live event streaming', 'http://127.0.0.1:7777/api/ingest')
    .action(async (opts) => {
      const { Orchestrator } = await import('./agentic/index.js');
      const { DashboardEventSink } = await import('./web/event-sink.js');
      const agents = parseAgentList(opts.agents);

      if (agents.length === 0) {
        console.error(`  ${theme.crossmark} ${theme.error('No agents specified. Use --agents role:backend,role:backend')}`);
        exitCode = 1;
        return;
      }

      const orchestrator = new Orchestrator();
      const sink = new DashboardEventSink(opts.dashboardUrl);

      // Bridge orchestrator events to dashboard SSE
      orchestrator.onEvent((event) => sink.push(event));

      try {
        const events = await orchestrator.run({
          agents,
          prompt: opts.prompt,
          maxTurns: parseInt(opts.maxTurns, 10),
          timeoutSeconds: parseInt(opts.timeout, 10),
          repoPath: opts.repo,
          sandbox: opts.sandbox,
        });

        await formatAgenticEvents(events);
      } finally {
        await sink.close();
        await orchestrator.close();
      }
    });

  agenticCmd
    .command('logs')
    .description('View past agentic sessions')
    .option('--session <id>', 'Show transcript for a specific session')
    .action(async (opts) => {
      const { TranscriptBus } = await import('./agentic/index.js');
      const bus = new TranscriptBus();

      try {
        if (opts.session) {
          const transcript = bus.getTranscript(opts.session);
          const session = bus.getSession(opts.session);
          if (!session) {
            console.error(`  ${theme.crossmark} Session ${opts.session} not found`);
            exitCode = 1;
            return;
          }
          console.log(`\n  ${theme.heading('Session')} ${theme.info(session.id)}`);
          console.log(`  ${theme.label('Prompt:')} ${session.prompt}`);
          console.log(`  ${theme.label('Status:')} ${session.status}`);
          console.log(`  ${theme.label('Agents:')} ${session.agents.map((a) => `${a.name}(${a.backend})`).join(', ')}`);
          console.log(`  ${theme.label('Messages:')} ${transcript.length}`);
          console.log('');
          for (const msg of transcript) {
            const time = msg.timestamp.toLocaleTimeString();
            const arrow = theme.hint('→');
            console.log(`  ${theme.hint(time)}  ${theme.bold(msg.from)} ${arrow} ${theme.bold(msg.to)}`);
            console.log(`    ${msg.content.split('\n')[0].slice(0, 120)}`);
          }
          console.log('');
        } else {
          const sessions = bus.listSessions();
          if (sessions.length === 0) {
            console.log(`\n  ${theme.hint('No agentic sessions found.')}\n`);
            return;
          }
          console.log(`\n  ${theme.heading('Agentic Sessions')}\n`);
          for (const s of sessions) {
            const status = s.status === 'completed' ? theme.success('✓')
              : s.status === 'active' ? theme.info('●')
              : s.status === 'failed' ? theme.error('✗')
              : theme.warning('■');
            const agents = s.agents.map((a) => `${a.name}(${a.backend})`).join(', ');
            const time = s.createdAt.toLocaleString();
            console.log(`  ${status} ${theme.bold(s.id)}  ${theme.hint(time)}`);
            console.log(`    ${theme.hint(s.prompt.slice(0, 100))}`);
            console.log(`    ${theme.hint(`Agents: ${agents}  |  Turns: ${s.turn}`)}`);
            console.log('');
          }
        }
      } finally {
        bus.close();
      }
    });

  agenticCmd
    .command('replay')
    .description('Replay a session transcript')
    .requiredOption('--session <id>', 'Session ID to replay')
    .action(async (opts) => {
      const { TranscriptBus } = await import('./agentic/index.js');
      const bus = new TranscriptBus();

      try {
        const session = bus.getSession(opts.session);
        if (!session) {
          console.error(`  ${theme.crossmark} Session ${opts.session} not found`);
          exitCode = 1;
          return;
        }

        const transcript = bus.getTranscript(opts.session);
        console.log(`\n  ${theme.heading('Replay:')} ${theme.info(session.id)}`);
        console.log(`  ${theme.label('Prompt:')} ${session.prompt}\n`);

        let lastTurn = -1;
        for (const msg of transcript) {
          if (msg.turn !== lastTurn) {
            console.log(`  ${theme.heading(`── Turn ${msg.turn} ──`)}`);
            lastTurn = msg.turn;
          }
          const time = msg.timestamp.toLocaleTimeString();
          const arrow = theme.hint('→');
          console.log(`  ${theme.hint(time)}  ${theme.bold(msg.from)} ${arrow} ${theme.bold(msg.to)}`);
          for (const line of msg.content.split('\n')) {
            console.log(`    ${line}`);
          }
          console.log('');
        }

        console.log(`  ${theme.label('Status:')} ${session.status}  |  ${theme.label('Turns:')} ${session.turn}\n`);
      } finally {
        bus.close();
      }
    });

  agenticCmd
    .command('dashboard')
    .description('Launch web dashboard for session visibility')
    .option('--port <number>', 'Port to listen on', '7777')
    .action(async (opts) => {
      const { startDashboard } = await import('./web/index.js');
      const port = parseInt(opts.port, 10);

      try {
        const dashboard = await startDashboard({ port });
        console.log(`\n  ${theme.heading('Agentic Dashboard')}`);
        console.log(`  ${theme.success('✓')} Running at ${theme.info(dashboard.url)}`);
        console.log(`  ${theme.hint('Press Ctrl+C to stop')}\n`);

        // Open browser
        const openCmd = process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'start'
          : 'xdg-open';
        spawnSync(openCmd, [dashboard.url], { stdio: 'ignore' });

        // Keep alive until Ctrl+C
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => {
            console.log(`\n  ${theme.hint('Shutting down dashboard...')}`);
            dashboard.close().then(resolve);
          });
          process.on('SIGTERM', () => {
            dashboard.close().then(resolve);
          });
        });
      } catch (err) {
        console.error(`  ${theme.crossmark} ${theme.error(err instanceof Error ? err.message : String(err))}`);
        exitCode = 1;
      }
    });

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
      console.error('');
      console.error(`  ${theme.crossmark} ${theme.error(err.message)}`);
      if (err.message.includes('too large')) {
        console.error(`  ${theme.hint('Try reducing the size of your input or context.')}`);
      }
      if (err.message.includes('depth limit')) {
        console.error(`  ${theme.hint('Agents are calling each other recursively.')}`);
      }
      console.error('');
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

// ---------------------------------------------------------------------------
// Agentic helpers
// ---------------------------------------------------------------------------

function parseAgentList(input: string): Array<{ name: string; backend: string; model?: string }> {
  return input.split(',').map((pair) => {
    const parts = pair.trim().split(':');
    if (parts.length < 2) return null;
    return {
      name: parts[0],
      backend: parts[1],
      model: parts[2] || undefined,
    };
  }).filter((a): a is NonNullable<typeof a> => a !== null);
}

async function formatAgenticEvents(events: AsyncIterable<import('./agentic/events.js').AgenticEvent>): Promise<void> {
  for await (const event of events) {
    const time = new Date().toLocaleTimeString();

    switch (event.type) {
      case 'session_start':
        console.log(`\n  ${theme.heading('Agentic Session')} ${theme.info(event.sessionId)}`);
        console.log(`  ${theme.label('Prompt:')} ${event.prompt}`);
        console.log(`  ${theme.label('Agents:')} ${event.agents.map((a) => `${theme.bold(a.name)}(${a.backend})`).join(', ')}\n`);
        break;
      case 'message': {
        const arrow = theme.hint('→');
        console.log(`  ${theme.hint(time)}  ${theme.bold(event.from)} ${arrow} ${theme.bold(event.to)}`);
        const lines = event.content.split('\n').slice(0, 3);
        for (const line of lines) {
          console.log(`    ${line}`);
        }
        if (event.content.split('\n').length > 3) {
          console.log(`    ${theme.hint(`... (${event.content.split('\n').length - 3} more lines)`)}`);
        }
        break;
      }
      case 'agent_status': {
        const icon = event.status === 'active' ? theme.info('●')
          : event.status === 'idle' ? theme.hint('○')
          : theme.error('✗');
        console.log(`  ${theme.hint(time)}  ${icon} ${event.agent}: ${event.status}`);
        break;
      }
      case 'turn_complete':
        console.log(`  ${theme.hint(`── Turn ${event.turn} complete (${event.pendingCount} pending) ──`)}`);
        break;
      case 'guardrail':
        console.log(`  ${theme.warning('⚠')} ${theme.warning(event.guard)}: ${event.detail}`);
        break;
      case 'session_end': {
        const elapsed = (event.elapsed / 1000).toFixed(1);
        console.log(`\n  ${theme.heading('Session ended')}: ${event.reason}`);
        console.log(`  ${theme.label('Turns:')} ${event.turn}  |  ${theme.label('Elapsed:')} ${elapsed}s\n`);
        break;
      }
      case 'error': {
        const prefix = event.agent ? `${event.agent}: ` : '';
        console.error(`  ${theme.crossmark} ${theme.error(`${prefix}${event.error}`)}`);
        break;
      }
    }
  }
}

/**
 * Interactive setup wizard.
 *
 * Scans the environment for available backends, lets the user choose a
 * default, optionally installs the Claude plugin, saves config, and offers
 * a quick verification test.
 */

import chalk from 'chalk';
import { select, confirm } from '@inquirer/prompts';
import { detectAll, type BackendStatus, type DetectionReport } from './detection.js';
import { saveConfig, configPaths, DEFAULT_CONFIG, type PafConfig } from './config.js';
import { installHosts } from './installer.js';
import { getVersion } from './version.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetupOptions {
  repoRoot?: string;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function mark(available: boolean, planned?: boolean): string {
  if (planned) return chalk.dim('[planned]');
  return available ? chalk.green('\u2713') : chalk.red('\u2717');
}

function printBackendLine(b: BackendStatus): void {
  const m = mark(b.available, b.planned);
  const line = `    ${m} ${b.name.padEnd(12)} ${b.detail}`;
  console.log(line);
  if (b.models && b.models.length > 0) {
    console.log(`${' '.repeat(19)}Models: ${b.models.join(', ')}`);
  }
  if (!b.available && !b.planned && b.installHint) {
    console.log(`${' '.repeat(19)}${chalk.dim(b.installHint)}`);
  }
}

function printReport(report: DetectionReport): void {
  console.log('  Relay Backends:');

  if (report.cli.length > 0) {
    console.log('    CLI:');
    for (const b of report.cli) printBackendLine(b);
  }

  if (report.local.length > 0) {
    console.log('    Local:');
    for (const b of report.local) printBackendLine(b);
  }

  if (report.api.length > 0) {
    console.log('    API:');
    for (const b of report.api) printBackendLine(b);
  }

  console.log('');
  console.log('  Host Integrations:');
  for (const b of report.host) printBackendLine(b);
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function getSelectableBackends(report: DetectionReport): BackendStatus[] {
  const allRelay = [...report.cli, ...report.local, ...report.api];
  return allRelay.filter(b => b.available && !b.planned);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function setup(opts?: SetupOptions): Promise<void> {
  const version = getVersion();
  const paths = configPaths(opts?.repoRoot);

  console.log('');
  console.log(`  phone-a-friend v${version} \u2014 ${chalk.bold('Setup')}`);
  console.log('');
  console.log('  Scanning your environment...');
  console.log('');

  // Detect all backends
  const report = await detectAll();
  printReport(report);
  console.log('');

  // Determine selectable backends (available + not planned)
  const selectable = getSelectableBackends(report);

  let selectedBackend: string;

  if (selectable.length === 0) {
    // No backends available
    console.log(chalk.yellow('  No relay backends available.'));
    console.log('  Install at least one backend to get started:');
    const allRelay = [...report.cli, ...report.local, ...report.api];
    for (const b of allRelay) {
      if (!b.planned && b.installHint) {
        console.log(`    ${b.name}: ${chalk.dim(b.installHint)}`);
      }
    }
    console.log('');
    selectedBackend = DEFAULT_CONFIG.defaults.backend;
  } else if (selectable.length === 1) {
    // Auto-select the only available backend
    selectedBackend = selectable[0].name;
    console.log(`  Default backend: ${chalk.bold(selectedBackend)} (only available backend)`);
  } else {
    // Prompt for selection
    selectedBackend = await select({
      message: 'Default backend:',
      choices: selectable.map(b => ({
        name: `${b.name} (${b.detail})`,
        value: b.name,
      })),
    });
  }

  // Offer Claude plugin install if claude is available
  const claudeAvailable = report.host.some(h => h.name === 'claude' && h.available);
  if (claudeAvailable) {
    const installPlugin = await confirm({
      message: 'Install as Claude Code plugin?',
      default: true,
    });
    if (installPlugin) {
      try {
        const repoRoot = opts?.repoRoot ?? process.cwd();
        const lines = installHosts({
          repoRoot,
          target: 'claude',
          mode: 'symlink',
          force: true,
          syncClaudeCli: true,
        });
        for (const line of lines) console.log(`  ${line}`);
      } catch (err) {
        console.log(chalk.yellow(`  Plugin install failed: ${(err as Error).message}`));
      }
    }
  }

  // Save config
  const cfg: PafConfig = {
    defaults: {
      backend: selectedBackend,
      sandbox: DEFAULT_CONFIG.defaults.sandbox,
      timeout: DEFAULT_CONFIG.defaults.timeout,
      include_diff: DEFAULT_CONFIG.defaults.include_diff,
    },
  };
  saveConfig(cfg, paths.user);
  console.log('');
  console.log(`  ${chalk.green('\u2713')} Config saved to ${paths.user}`);

  // Offer test run
  if (selectable.length > 0) {
    const runTest = await confirm({
      message: 'Run a quick test?',
      default: true,
    });
    if (runTest) {
      console.log(`  Testing ${selectedBackend}...`);
      try {
        // Dynamic import to avoid circular dependency
        const { relay } = await import('./relay.js');
        const result = relay({
          prompt: 'Say hello in one sentence.',
          repoPath: process.cwd(),
          backend: selectedBackend,
          timeoutSeconds: 30,
        });
        console.log(`  ${chalk.green('\u2713')} ${selectedBackend} responded`);
      } catch (err) {
        console.log(chalk.yellow(`  ${selectedBackend} test failed: ${(err as Error).message}`));
      }
    }
  }

  console.log('');
  console.log('  You\'re ready! Try:');
  console.log(`    phone-a-friend --prompt "What does this project do?"`);
  console.log('');
  console.log(`  Tip: ${chalk.dim("alias paf='phone-a-friend'")}`);
  console.log('');
}

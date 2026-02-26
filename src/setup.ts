/**
 * Interactive setup wizard.
 *
 * Scans the environment for available backends, lets the user choose a
 * default, optionally installs the Claude plugin, saves config, and offers
 * a quick verification test.
 */

import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';
import { detectAll, type BackendStatus, type DetectionReport } from './detection.js';
import { loadConfig, saveConfig, configPaths, DEFAULT_CONFIG, type PafConfig } from './config.js';
import { installHosts } from './installer.js';
import { formatBackendLine, formatBackendModels } from './display.js';
import { theme, banner } from './theme.js';
import { getPackageRoot } from './version.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetupOptions {
  repoRoot?: string;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function printBackendLine(b: BackendStatus): void {
  console.log(`    ${formatBackendLine(b).trimStart()}`);
  const modelsLine = formatBackendModels(b);
  if (modelsLine) console.log(modelsLine);
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

  console.log('');
  console.log('  Host Integrations:');
  for (const b of report.host) printBackendLine(b);
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function getSelectableBackends(report: DetectionReport): BackendStatus[] {
  const allRelay = [...report.cli, ...report.local];
  return allRelay.filter(b => b.available && !b.planned);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function setup(opts?: SetupOptions): Promise<void> {
  const paths = configPaths(opts?.repoRoot);

  console.log('');
  console.log(banner('Setup'));
  console.log('');

  const scanSpinner = ora({
    text: 'Scanning your environment...',
    spinner: 'dots',
    color: 'cyan',
    stream: process.stderr,
  }).start();

  // Detect all backends
  const report = await detectAll();
  scanSpinner.succeed('Environment scanned');
  console.log('');

  printReport(report);
  console.log('');

  // Determine selectable backends (available + not planned)
  const selectable = getSelectableBackends(report);

  let selectedBackend: string;

  console.log(`  ${theme.hint('Step 1/3')} ${theme.heading('Choose default backend')}`);

  if (selectable.length === 0) {
    // No backends available
    console.log(theme.warning('  No relay backends available.'));
    console.log('  Install at least one backend to get started:');
    const allRelay = [...report.cli, ...report.local];
    for (const b of allRelay) {
      if (!b.planned && b.installHint) {
        console.log(`    ${b.name}: ${theme.hint(b.installHint)}`);
      }
    }
    console.log('');
    selectedBackend = DEFAULT_CONFIG.defaults.backend;
  } else if (selectable.length === 1) {
    // Auto-select the only available backend
    selectedBackend = selectable[0].name;
    console.log(`  Default backend: ${theme.bold(selectedBackend)} (only available backend)`);
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
    console.log(`  ${theme.hint('Step 2/3')} ${theme.heading('Claude integration')}`);
    const installPlugin = await confirm({
      message: 'Install as Claude Code plugin?',
      default: true,
    });
    if (installPlugin) {
      try {
        const repoRoot = opts?.repoRoot ?? getPackageRoot();
        const lines = installHosts({
          repoRoot,
          target: 'claude',
          mode: 'symlink',
          force: true,
          syncClaudeCli: true,
        });
        for (const line of lines) console.log(`  ${line}`);
      } catch (err) {
        console.log(theme.warning(`  Plugin install failed: ${(err as Error).message}`));
      }
    }
  }

  // Save config — merge into existing to preserve user's backend settings
  const existing = loadConfig(opts?.repoRoot);
  const cfg: PafConfig = {
    ...existing,
    defaults: {
      ...existing.defaults,
      backend: selectedBackend,
    },
  };
  saveConfig(cfg, paths.user);
  console.log('');
  console.log(`  ${theme.checkmark} Config saved to ${paths.user}`);

  // Offer test run
  if (selectable.length > 0) {
    console.log(`  ${theme.hint('Step 3/3')} ${theme.heading('Verify')}`);
    const runTest = await confirm({
      message: 'Run a quick test?',
      default: true,
    });
    if (runTest) {
      const testSpinner = ora({
        text: `Testing ${selectedBackend}...`,
        spinner: 'dots',
        color: 'cyan',
        stream: process.stderr,
      }).start();
      try {
        // Dynamic import to avoid circular dependency
        const { relay } = await import('./relay.js');
        await relay({
          prompt: 'Say hello in one sentence.',
          repoPath: process.cwd(),
          backend: selectedBackend,
          timeoutSeconds: 30,
        });
        testSpinner.succeed(`${selectedBackend} responded`);
      } catch (err) {
        testSpinner.fail(`${selectedBackend} test failed: ${(err as Error).message}`);
      }
    }
  }

  console.log('');
  console.log(`  ${theme.checkmark} ${theme.success('Setup complete!')}`);
  console.log('');
  console.log(`  ${theme.label('Backend:')}  ${selectedBackend}`);
  console.log(`  ${theme.label('Config:')}   ${paths.user}`);
  console.log('');
  console.log(`  ${theme.hint('Next steps:')}`);
  console.log(`    ${theme.info('phone-a-friend --to ' + selectedBackend + ' --prompt "What does this project do?"')}`);
  console.log(`    ${theme.info('phone-a-friend agentic run --agents reviewer:claude --prompt "Review auth"')}`);
  console.log('');
  console.log(`  ${theme.hint('Marketplace:')}`);
  console.log(`    You can also install the Claude Code plugin via the marketplace:`);
  console.log(`    ${theme.info('/plugin marketplace add freibergergarcia/phone-a-friend')}`);
  console.log(`    ${theme.info('/plugin install phone-a-friend@phone-a-friend-marketplace')}`);
  console.log('');
  console.log(`    ${theme.hint('Note: Marketplace install provides Claude Code commands and skills only.')}`);
  console.log(`    ${theme.hint('The full CLI (agentic mode, TUI, web dashboard) requires the global npm install.')}`);
  console.log('');
  console.log(`  Tip: ${theme.hint("alias paf='phone-a-friend'")}`);
  console.log('');
}

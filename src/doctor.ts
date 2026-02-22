/**
 * Doctor command — health check for all backends, config, and integrations.
 *
 * Exit codes:
 *   0 = all relay backends healthy
 *   1 = some backends have issues
 *   2 = no relay backends available
 */

import chalk from 'chalk';
import { detectAll, type DetectionReport, type BackendStatus } from './detection.js';
import { loadConfig, configPaths, DEFAULT_CONFIG, type PafConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorOptions {
  json?: boolean;
  repoRoot?: string;
}

export interface DoctorResult {
  exitCode: number;
  output: string;
}

// ---------------------------------------------------------------------------
// Version helper
// ---------------------------------------------------------------------------

function getVersion(): string {
  try {
    const { readFileSync } = require('node:fs');
    const { resolve, dirname } = require('node:path');
    const thisDir = dirname(__filename);
    const pkgPath = resolve(thisDir, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function mark(available: boolean, planned?: boolean): string {
  if (planned) return chalk.dim('[planned]');
  return available ? chalk.green('\u2713') : chalk.red('\u2717');
}

function formatBackend(b: BackendStatus): string {
  const m = mark(b.available, b.planned);
  const line = `    ${m} ${b.name.padEnd(12)} ${b.detail}`;
  if (!b.available && !b.planned && b.installHint) {
    return `${line}\n${' '.repeat(19)}${chalk.dim(b.installHint)}`;
  }
  return line;
}

function formatHumanReadable(
  report: DetectionReport,
  config: PafConfig,
  paths: { user: string; repo: string | null },
): string {
  const version = getVersion();
  const lines: string[] = [];

  lines.push('');
  lines.push(`  phone-a-friend v${version} \u2014 ${chalk.bold('Health Check')}`);
  lines.push('');

  // System
  lines.push('  System:');
  lines.push(`    ${chalk.green('\u2713')} Node.js ${process.version}`);
  lines.push(`    ${chalk.green('\u2713')} Config ${paths.user}`);
  lines.push('');

  // Relay Backends
  lines.push('  Relay Backends:');

  // CLI
  if (report.cli.length > 0) {
    lines.push('    CLI:');
    for (const b of report.cli) {
      lines.push(`  ${formatBackend(b)}`);
    }
  }

  // Local
  if (report.local.length > 0) {
    lines.push('    Local:');
    for (const b of report.local) {
      lines.push(`  ${formatBackend(b)}`);
      if (b.models && b.models.length > 0) {
        lines.push(`${' '.repeat(21)}Models: ${b.models.join(', ')}`);
      }
    }
  }

  // API
  if (report.api.length > 0) {
    lines.push('    API:');
    for (const b of report.api) {
      lines.push(`  ${formatBackend(b)}`);
    }
  }

  lines.push('');

  // Host Integrations
  lines.push('  Host Integrations:');
  for (const b of report.host) {
    lines.push(`  ${formatBackend(b)}`);
  }
  lines.push('');

  // Default
  const defaultBackend = config.defaults?.backend ?? DEFAULT_CONFIG.defaults.backend;
  lines.push(`  Default: ${defaultBackend}`);
  lines.push('');

  // Summary count
  const allRelay = [...report.cli, ...report.local, ...report.api];
  const available = allRelay.filter(b => b.available).length;
  const total = allRelay.length;
  lines.push(`  ${available} of ${total} relay backends ready`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

function formatJson(
  report: DetectionReport,
  config: PafConfig,
  exitCode: number,
): string {
  const allRelay = [...report.cli, ...report.local, ...report.api];
  const available = allRelay.filter(b => b.available).length;
  const total = allRelay.length;

  return JSON.stringify({
    system: {
      nodeVersion: process.version,
      version: getVersion(),
    },
    backends: {
      cli: report.cli,
      local: report.local,
      api: report.api,
    },
    host: report.host,
    default: config.defaults?.backend ?? DEFAULT_CONFIG.defaults.backend,
    summary: { available, total },
    exitCode,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Exit code logic
// ---------------------------------------------------------------------------

function computeExitCode(report: DetectionReport): number {
  const allRelay = [...report.cli, ...report.local, ...report.api];
  const available = allRelay.filter(b => b.available).length;

  if (available === 0) return 2;

  const total = allRelay.length;
  if (available < total) return 1;

  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function doctor(opts?: DoctorOptions): Promise<DoctorResult> {
  const report = await detectAll();
  const paths = configPaths(opts?.repoRoot);
  const config = loadConfig(opts?.repoRoot);
  const exitCode = computeExitCode(report);

  if (opts?.json) {
    return {
      exitCode,
      output: formatJson(report, config, exitCode),
    };
  }

  return {
    exitCode,
    output: formatHumanReadable(report, config, paths),
  };
}

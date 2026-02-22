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
import { getVersion } from './version.js';
import { formatBackendLine, formatBackendModels } from './display.js';

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
      lines.push(`  ${formatBackendLine(b)}`);
    }
  }

  // Local
  if (report.local.length > 0) {
    lines.push('    Local:');
    for (const b of report.local) {
      lines.push(`  ${formatBackendLine(b)}`);
      const modelsLine = formatBackendModels(b);
      if (modelsLine) lines.push(modelsLine);
    }
  }

  // API
  if (report.api.length > 0) {
    lines.push('    API:');
    for (const b of report.api) {
      lines.push(`  ${formatBackendLine(b)}`);
    }
  }

  lines.push('');

  // Host Integrations
  lines.push('  Host Integrations:');
  for (const b of report.host) {
    lines.push(`  ${formatBackendLine(b)}`);
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
  // Only count implemented (non-planned) backends for exit code
  const allRelay = [...report.cli, ...report.local, ...report.api].filter(b => !b.planned);
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

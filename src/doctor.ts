/**
 * Doctor command — health check for all backends, config, and integrations.
 *
 * Exit codes:
 *   0 = all relay backends healthy
 *   1 = some backends have issues
 *   2 = no relay backends available
 */

import { detectAll, decorateOpenCodeModels, type DetectionReport } from './detection.js';
import { loadConfig, configPaths, DEFAULT_CONFIG, type PafConfig } from './config.js';
import { getVersion } from './version.js';
import { formatBackendLine, formatBackendModels } from './display.js';
import { theme, banner } from './theme.js';
import { isOpenCodeInstalled, isPluginInstalled } from './installer.js';

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

export interface HostInstallations {
  claude: boolean;
  opencode: boolean;
}

function formatHumanReadable(
  report: DetectionReport,
  config: PafConfig,
  paths: { user: string; repo: string | null },
  hostInstallations: HostInstallations,
  advisories: string[] = [],
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(banner('Health Check'));
  lines.push('');

  // System
  lines.push(`  ${theme.label('System:')}`);
  lines.push(`    ${theme.checkmark} Node.js ${process.version}`);
  lines.push(`    ${theme.checkmark} Config ${paths.user}`);
  lines.push('');

  // Relay Backends
  lines.push(`  ${theme.label('Relay Backends:')}`);

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

  lines.push('');

  // Host Integrations
  lines.push(`  ${theme.label('Host Integrations:')}`);
  for (const b of report.host) {
    lines.push(`  ${formatBackendLine(b)}`);
  }
  lines.push('');

  // Installed host commands/plugins
  lines.push(`  ${theme.label('Host Install Status:')}`);
  lines.push(`    ${hostInstallations.claude ? theme.checkmark : theme.warning('!')} Claude plugin ${hostInstallations.claude ? theme.success('installed') : theme.warning('not installed')}`);
  lines.push(`    ${hostInstallations.opencode ? theme.checkmark : theme.warning('!')} OpenCode commands/skills ${hostInstallations.opencode ? theme.success('installed') : theme.warning('not installed')}`);
  lines.push('');

  // Default
  const defaultBackend = config.defaults?.backend ?? DEFAULT_CONFIG.defaults.backend;
  lines.push(`  ${theme.label('Default:')} ${defaultBackend}`);
  lines.push('');

  // Summary count — colored by health status
  const allRelay = [...report.cli, ...report.local];
  const available = allRelay.filter(b => b.available).length;
  const total = allRelay.length;
  const summaryColor = available === total ? theme.success :
                       available > 0 ? theme.warning : theme.error;
  lines.push(`  ${summaryColor(`${available} of ${total} relay backends ready`)}`);
  lines.push('');

  if (advisories.length > 0) {
    lines.push(`  ${theme.label('Advisories:')}`);
    for (const advisory of advisories) {
      lines.push(`    ${theme.warning(advisory)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

// Normalize backend status for JSON output: omit empty models arrays
// so the shape stays backward-compatible (models key only present when non-empty).
function normalizeForJson(backends: import('./detection.js').BackendStatus[]) {
  return backends.map(b => {
    if (b.models && b.models.length === 0) {
      const { models: _, ...rest } = b;
      return rest;
    }
    return b;
  });
}

function formatJson(
  report: DetectionReport,
  config: PafConfig,
  exitCode: number,
  hostInstallations: HostInstallations,
  advisories: string[] = [],
): string {
  const allRelay = [...report.cli, ...report.local];
  const available = allRelay.filter(b => b.available).length;
  const total = allRelay.length;

  return JSON.stringify({
    system: {
      nodeVersion: process.version,
      version: getVersion(),
    },
    backends: {
      cli: normalizeForJson(report.cli),
      local: normalizeForJson(report.local),
    },
    host: normalizeForJson(report.host),
    hostInstallations,
    default: config.defaults?.backend ?? DEFAULT_CONFIG.defaults.backend,
    summary: { available, total },
    advisories,
    exitCode,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Exit code logic
// ---------------------------------------------------------------------------

function computeExitCode(report: DetectionReport): number {
  // Only count implemented (non-planned) backends for exit code
  const allRelay = [...report.cli, ...report.local].filter(b => !b.planned);
  const available = allRelay.filter(b => b.available).length;

  if (available === 0) return 2;

  const total = allRelay.length;
  if (available < total) return 1;

  return 0;
}

// ---------------------------------------------------------------------------
// Advisories
// ---------------------------------------------------------------------------

const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';

async function probeOllamaVersion(): Promise<string | null> {
  const host = process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(`${host}/api/version`, { signal: controller.signal });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function semverLt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

async function collectAdvisories(report: DetectionReport): Promise<string[]> {
  const opencode = report.cli.find(b => b.name === 'opencode' && b.available);
  if (!opencode) return [];
  const version = await probeOllamaVersion();
  if (!version) {
    return ['OpenCode detected but could not verify Ollama version. Tool-calling models need Ollama >= 0.17.'];
  }
  if (semverLt(version, '0.17.0')) {
    return [`OpenCode detected but Ollama ${version} is below 0.17. Tool calling will not work with newer models.`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function doctor(opts?: DoctorOptions): Promise<DoctorResult> {
  const report = await detectAll();
  decorateOpenCodeModels(report);
  const paths = configPaths(opts?.repoRoot);
  const config = loadConfig(opts?.repoRoot);
  const exitCode = computeExitCode(report);
  const advisories = await collectAdvisories(report);
  const hostInstallations = {
    claude: isPluginInstalled(),
    opencode: isOpenCodeInstalled(),
  };

  if (opts?.json) {
    return {
      exitCode,
      output: formatJson(report, config, exitCode, hostInstallations, advisories),
    };
  }

  return {
    exitCode,
    output: formatHumanReadable(report, config, paths, hostInstallations, advisories),
  };
}

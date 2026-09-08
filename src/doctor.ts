/**
 * Doctor command — health check for all backends, config, and integrations.
 *
 * Exit codes:
 *   0 = all relay backends healthy
 *   1 = some backends have issues
 *   2 = no relay backends available
 */

import { detectAll, decorateOpenCodeModels, type DetectionReport, type BackendStatus } from './detection.js';
import { loadConfig, configPaths, DEFAULT_CONFIG, type PafConfig } from './config.js';
import { getVersion } from './version.js';
import { formatBackendLine, formatBackendModels } from './display.js';
import { theme, banner } from './theme.js';
import { isCodexInstalled, isOpenCodeInstalled, isPluginInstalled } from './installer.js';
import { defaultCachePath, readSnapshot, type UpdateCheckSnapshot } from './updates.js';
import {
  inspectExecutables,
  attachModelAndCapabilities,
  inspectPafIdentity,
  type PafIdentity,
} from './diagnostics.js';

/**
 * Backends that count toward the "X of Y ready" summary and exit code.
 *
 * Excludes:
 * - planned backends (declared but not yet implemented)
 * - optional backends that the user does not have installed (e.g. OpenCode
 *   CLI for a Claude-Code-only install)
 *
 * Available optional backends ARE counted (so installing OpenCode lifts it
 * into the denominator and the user gets a healthy "all ready" count when
 * everything they have is working).
 */
function countableBackends(report: DetectionReport): BackendStatus[] {
  return [...report.cli, ...report.local].filter(b => {
    if (b.planned) return false;
    if (b.optional && !b.available) return false;
    return true;
  });
}

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
  codex: boolean;
}

function formatHumanReadable(
  report: DetectionReport,
  config: PafConfig,
  paths: { user: string; repo: string | null },
  hostInstallations: HostInstallations,
  advisories: string[] = [],
  updateCheck: UpdateCheckState | null = null,
  paf: PafIdentity | null = null,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(banner('Health Check'));
  lines.push('');

  // System
  lines.push(`  ${theme.label('System:')}`);
  lines.push(`    ${theme.checkmark} Node.js ${process.version}`);
  if (paf) {
    lines.push(`    ${theme.checkmark} phone-a-friend ${paf.version} ${theme.hint(`(running from ${paf.packageRoot})`)}`);
    for (const line of formatPafPathLines(paf)) lines.push(line);
  }
  lines.push(`    ${theme.checkmark} Config ${paths.user}`);
  lines.push('');

  if (updateCheck) {
    lines.push(`  ${theme.label('Update check:')}`);
    lines.push(`    ${theme.hint('cache:')} ${updateCheck.cachePath}`);
    lines.push(`    ${theme.hint('current:')} ${updateCheck.currentVersion}`);
    lines.push(
      `    ${theme.hint('latest known:')} ${updateCheck.latestVersion ?? '(not yet fetched)'}`,
    );
    lines.push(
      `    ${theme.hint('last checked:')} ${updateCheck.lastCheckedAt ?? '(never)'}`,
    );
    lines.push(
      `    ${theme.hint('config opt-in:')} ${updateCheck.configEnabled ? 'enabled' : 'disabled'}`,
    );
    lines.push('');
  }

  // Relay Backends
  lines.push(`  ${theme.label('Relay Backends:')}`);

  // CLI
  if (report.cli.length > 0) {
    lines.push('    CLI:');
    for (const b of report.cli) {
      lines.push(`  ${formatBackendLine(b)}`);
      lines.push(...formatDiagnosticLines(b));
    }
  }

  // Local
  if (report.local.length > 0) {
    lines.push('    Local:');
    for (const b of report.local) {
      lines.push(`  ${formatBackendLine(b)}`);
      lines.push(...formatDiagnosticLines(b));
      const modelsLine = formatBackendModels(b);
      if (modelsLine) lines.push(modelsLine);
    }
  }

  lines.push('');

  // Host Integrations. Commands already detailed above (codex, opencode)
  // get a one-line pointer instead of a repeated block.
  const detailed = new Set(
    [...report.cli, ...report.local].map(b => b.executable?.command).filter(Boolean),
  );
  lines.push(`  ${theme.label('Host Integrations:')}`);
  for (const b of report.host) {
    lines.push(`  ${formatBackendLine(b)}`);
    if (b.executable && detailed.has(b.executable.command)) {
      lines.push(`${DIAG_INDENT}${theme.hint(`exec: same as relay backend "${b.name}" above`)}`);
    } else {
      lines.push(...formatDiagnosticLines(b));
    }
  }
  lines.push('');

  // Installed host commands/plugins
  lines.push(`  ${theme.label('Host Install Status:')}`);
  lines.push(`    ${hostInstallations.claude ? theme.checkmark : theme.warning('!')} Claude plugin ${hostInstallations.claude ? theme.success('installed') : theme.warning('not installed')}`);
  lines.push(`    ${hostInstallations.opencode ? theme.checkmark : theme.warning('!')} OpenCode commands/skills ${hostInstallations.opencode ? theme.success('installed') : theme.warning('not installed')}`);
  lines.push(`    ${hostInstallations.codex ? theme.checkmark : theme.warning('!')} Codex skills ${hostInstallations.codex ? theme.success('installed') : theme.warning('not installed')}`);
  lines.push('');

  // Default
  const defaultBackend = config.defaults?.backend ?? DEFAULT_CONFIG.defaults.backend;
  lines.push(`  ${theme.label('Default:')} ${defaultBackend}`);
  lines.push('');

  // Summary count — colored by health status
  const counted = countableBackends(report);
  const available = counted.filter(b => b.available).length;
  const total = counted.length;
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
// Executable / model diagnostics rendering
// ---------------------------------------------------------------------------

const DIAG_INDENT = ' '.repeat(21);

function describeCandidate(c: { path: string; version: string | null; versionStatus: string }): string {
  return `${c.path} (${c.version ?? `version ${c.versionStatus}`})`;
}

/**
 * Lines rendered under a backend entry: the executable PaF will actually
 * spawn, any other PATH candidates, and requested-vs-reported model.
 * Only rendered when diagnostics were collected for that entry.
 */
function formatDiagnosticLines(b: BackendStatus): string[] {
  const lines: string[] = [];
  const exe = b.executable;
  if (exe?.selected) {
    const label = b.name === 'ollama' ? 'local client (relay uses HTTP):' : 'exec:';
    lines.push(`${DIAG_INDENT}${theme.hint(label)} ${describeCandidate(exe.selected)}`);
    if (exe.shadowed) {
      const others = exe.candidates.filter(c => c !== exe.selected).map(describeCandidate).join(', ');
      const flag = exe.versionMismatch ? ` ${theme.warning('[versions differ]')}` : '';
      lines.push(`${DIAG_INDENT}${theme.hint('also on PATH:')} ${others}${flag}`);
    }
  }
  if (b.model && (exe?.selected || b.name === 'ollama')) {
    const requested = b.model.requested
      ? `${b.model.requested} (from PaF config)`
      : 'backend default';
    lines.push(
      `${DIAG_INDENT}${theme.hint('model:')} requested=${requested}, reported=unknown ${theme.hint('(doctor runs no backend)')}`,
    );
  }
  if (b.capabilities) {
    const declared = b.capabilities.declared;
    lines.push(`${DIAG_INDENT}${theme.hint('adapter capabilities (not CLI-verified):')} ` +
      `resume=${declared.resumeStrategy}, client session ID=${declared.requiresClientSessionId}, local files=${declared.localFileAccess}`);
  }
  return lines;
}

function formatPafPathLines(paf: PafIdentity): string[] {
  const lines: string[] = [];
  if (paf.pathCandidates.length === 0) {
    lines.push(`${DIAG_INDENT}${theme.hint('on PATH:')} phone-a-friend not found`);
    return lines;
  }
  const [first, ...rest] = paf.pathCandidates;
  const flag = paf.runningDiffersFromPath ? ` ${theme.warning('[differs from this run]')}` : '';
  lines.push(`${DIAG_INDENT}${theme.hint('on PATH:')} ${describeCandidate(first)}${flag}`);
  if (rest.length > 0) {
    lines.push(`${DIAG_INDENT}${theme.hint('also on PATH:')} ${rest.map(describeCandidate).join(', ')}`);
  }
  return lines;
}

/**
 * Actionable advisories derived from executable diagnostics. Duplicates with
 * identical versions are informational only and stay out of this list.
 */
function collectDiagnosticAdvisories(report: DetectionReport, paf: PafIdentity | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of [...report.cli, ...report.local, ...report.host]) {
    const exe = b.executable;
    if (!exe || seen.has(exe.command)) continue;
    seen.add(exe.command);
    const probeFailed = exe.candidates.some(c => c.versionStatus !== 'ok' && c.versionStatus !== 'not-probed');
    if (exe.versionMismatch || probeFailed) {
      out.push(...exe.guidance);
    }
  }
  if (paf) out.push(...paf.guidance);
  return out;
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
  updateCheck: UpdateCheckState | null = null,
  paf: PafIdentity | null = null,
): string {
  const counted = countableBackends(report);
  const available = counted.filter(b => b.available).length;
  const total = counted.length;

  return JSON.stringify({
    system: {
      nodeVersion: process.version,
      version: getVersion(),
      paf: paf ?? undefined,
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
    updateCheck: updateCheck ?? undefined,
    exitCode,
  }, null, 2);
}

interface UpdateCheckState {
  cachePath: string;
  currentVersion: string;
  latestVersion: string | null;
  lastCheckedAt: string | null;
  lastNotifiedVersion: string | null;
  lastNotifiedAt: string | null;
  configEnabled: boolean;
}

function collectUpdateCheckState(config: PafConfig): UpdateCheckState {
  const cachePath = defaultCachePath();
  const currentVersion = getVersion();
  const snapshot: UpdateCheckSnapshot = readSnapshot(cachePath, currentVersion);
  return {
    cachePath,
    currentVersion,
    latestVersion: snapshot.latestVersion,
    lastCheckedAt: snapshot.lastCheckedAt,
    lastNotifiedVersion: snapshot.lastNotifiedVersion,
    lastNotifiedAt: snapshot.lastNotifiedAt,
    configEnabled: config.defaults?.update_check !== false,
  };
}

// ---------------------------------------------------------------------------
// Exit code logic
// ---------------------------------------------------------------------------

function computeExitCode(report: DetectionReport): number {
  const counted = countableBackends(report);
  const available = counted.filter(b => b.available).length;

  if (available === 0) return 2;

  const total = counted.length;
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

  // Executable diagnostics: PATH resolution + bounded --version probes.
  // Additive only; never affects availability or the exit code.
  await inspectExecutables(report);
  attachModelAndCapabilities(report, config);
  const paf = inspectPafIdentity();

  const advisories = [
    ...(await collectAdvisories(report)),
    ...collectDiagnosticAdvisories(report, paf),
  ];
  const hostInstallations = {
    claude: isPluginInstalled(),
    opencode: isOpenCodeInstalled(),
    codex: isCodexInstalled(),
  };
  const updateCheck = collectUpdateCheckState(config);

  if (opts?.json) {
    return {
      exitCode,
      output: formatJson(report, config, exitCode, hostInstallations, advisories, updateCheck, paf),
    };
  }

  return {
    exitCode,
    output: formatHumanReadable(report, config, paths, hostInstallations, advisories, updateCheck, paf),
  };
}

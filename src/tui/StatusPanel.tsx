/**
 * Status panel — system info + backend detection summary.
 * Data source: detectAll() directly, NOT doctor.ts formatted output.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from './components/Badge.js';
import type { BadgeStatus } from './components/Badge.js';
import type { BackendStatus, DetectionReport, EnvironmentStatus } from '../detection.js';

import { getVersion } from '../version.js';

// Cache version at module level to avoid sync FS reads in render
const cachedVersion = getVersion();

function backendBadgeStatus(b: BackendStatus): BadgeStatus {
  if (b.planned) return 'planned';
  if (b.available) return 'available';
  // Partial: Ollama with models array present but empty, or has models but isn't available
  if (b.name === 'ollama' && b.models !== undefined) return 'partial';
  // Ollama installed (has installHint for 'ollama serve') but not running
  if (b.name === 'ollama' && b.installHint === 'ollama serve') return 'partial';
  return 'unavailable';
}

function BackendRow({ backend }: { backend: BackendStatus }) {
  const status = backendBadgeStatus(backend);
  return (
    <Box gap={1}>
      <Text>  </Text>
      <Badge status={status} />
      <Text bold>{backend.name}</Text>
      <Text dimColor>{backend.detail}</Text>
      {backend.planned && <Text dimColor>[planned]</Text>}
    </Box>
  );
}

function CategorySection({ label, backends }: { label: string; backends: BackendStatus[] }) {
  if (backends.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text dimColor>  {label}</Text>
      {backends.map((b) => (
        <BackendRow key={b.name} backend={b} />
      ))}
    </Box>
  );
}

export interface StatusPanelProps {
  report: DetectionReport | null;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
}

export function StatusPanel({ report, loading, refreshing, error }: StatusPanelProps) {
  // Initial load with no report yet
  if (!report) {
    // Show error if detection failed before producing any report
    if (error) {
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold underline>System</Text>
            <Text>  Node.js    {process.version}</Text>
            <Text>  phone-a-friend  {cachedVersion}</Text>
          </Box>
          <Box>
            <Text color="red">Detection failed: {error.message}</Text>
          </Box>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text color="cyan">Scanning backends...</Text>
      </Box>
    );
  }

  // Count available relay backends (exclude host integrations and planned)
  const allRelay = [...report.cli, ...report.local];
  const nonPlanned = allRelay.filter((b) => !b.planned);
  const available = nonPlanned.filter((b) => b.available).length;
  const total = nonPlanned.length;

  return (
    <Box flexDirection="column" gap={1}>
      {/* System info */}
      <Box flexDirection="column">
        <Text bold underline>System</Text>
        <Text>  Node.js    {process.version}</Text>
        <Text>  phone-a-friend  {cachedVersion}</Text>
      </Box>

      {/* Error display */}
      {error && (
        <Box>
          <Text color="red">Detection error: {error.message}</Text>
        </Box>
      )}

      {/* Refreshing indicator */}
      {refreshing && (
        <Box>
          <Text color="cyan">Refreshing...</Text>
        </Box>
      )}

      {/* Backend summary */}
      <Box flexDirection="column">
        <Text bold underline>Relay Backends ({available} of {total} ready)</Text>
        <CategorySection label="CLI" backends={report.cli} />
        <CategorySection label="Local" backends={report.local} />
      </Box>

      {/* Host integrations */}
      <Box flexDirection="column">
        <Text bold underline>Host Integrations</Text>
        {report.host.map((b) => (
          <BackendRow key={b.name} backend={b} />
        ))}
      </Box>

      {/* Environment */}
      <EnvironmentSection environment={report.environment} />

      {/* Pro Tip */}
      <ProTip environment={report.environment} />
    </Box>
  );
}

function EnvironmentSection({ environment }: { environment: EnvironmentStatus }) {
  const tmuxStatus: BadgeStatus = environment.tmux.active
    ? 'available'
    : environment.tmux.installed
      ? 'partial'
      : 'unavailable';
  const tmuxDetail = environment.tmux.active
    ? 'active session'
    : environment.tmux.installed
      ? 'installed (not in session)'
      : 'not installed';

  const teamsStatus: BadgeStatus = environment.agentTeams.enabled ? 'available' : 'unavailable';
  const teamsDetail = environment.agentTeams.enabled ? 'enabled' : 'not enabled';

  return (
    <Box flexDirection="column">
      <Text bold underline>Environment</Text>
      <Box gap={1}>
        <Text>  </Text>
        <Badge status={tmuxStatus} />
        <Text bold>tmux</Text>
        <Text dimColor>{tmuxDetail}</Text>
      </Box>
      <Box gap={1}>
        <Text>  </Text>
        <Badge status={teamsStatus} />
        <Text bold>Agent Teams</Text>
        <Text dimColor>{teamsDetail}</Text>
      </Box>
    </Box>
  );
}

function ProTip({ environment }: { environment: EnvironmentStatus }) {
  // Hide when user is actively in tmux + has agent teams enabled (optimal setup)
  if (environment.tmux.active && environment.agentTeams.enabled) return null;

  return (
    <Box flexDirection="column">
      <Text bold underline color="yellow">Pro Tip</Text>
      <Text dimColor>  Use tmux + Claude Code Agent Teams for parallel agent collaboration.</Text>
      <Text color="cyan">  → https://docs.claude.com/en/docs/agent-teams</Text>
    </Box>
  );
}

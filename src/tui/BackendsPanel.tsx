/**
 * Backends panel — navigable list of all backends with detail pane.
 * Read-only: shows status, models, config, install hints.
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Badge } from './components/Badge.js';
import type { BadgeStatus } from './components/Badge.js';
import { ListSelect } from './components/ListSelect.js';
import type { DetectionReport, BackendStatus } from '../detection.js';
import { loadConfig } from '../config.js';

function badgeStatus(b: BackendStatus): BadgeStatus {
  if (b.planned) return 'planned';
  if (b.available) return 'available';
  if (b.name === 'ollama' && (b.models !== undefined || b.installHint === 'ollama serve')) return 'partial';
  return 'unavailable';
}

function BackendDetail({ backend }: { backend: BackendStatus }) {
  const config = loadConfig();
  const backendConfig = config.backends?.[backend.name];

  return (
    <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor="gray" paddingRight={2}>
      <Text bold>{backend.name}</Text>
      <Text> </Text>

      {/* Status */}
      <Box gap={1}>
        <Badge status={badgeStatus(backend)} />
        <Text>{backend.detail}</Text>
      </Box>
      {backend.planned && <Text dimColor>[planned — not yet implemented]</Text>}

      {/* Models (Ollama) */}
      {backend.models && backend.models.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Models:</Text>
          {backend.models.map((m) => (
            <Text key={m}>  {m}</Text>
          ))}
        </Box>
      )}

      {/* Config */}
      {backendConfig && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Config:</Text>
          {Object.entries(backendConfig).map(([key, val]) => (
            <Text key={key}>  {key}: {String(val)}</Text>
          ))}
        </Box>
      )}

      {/* Install hint */}
      {!backend.available && !backend.planned && backend.installHint && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">Install:</Text>
          <Text>  {backend.installHint}</Text>
        </Box>
      )}
    </Box>
  );
}

export interface BackendsPanelProps {
  report: DetectionReport | null;
}

export function BackendsPanel({ report }: BackendsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!report) {
    return <Text color="cyan">Loading backends...</Text>;
  }

  // Flatten all backends into one list
  const allBackends = [
    ...report.cli,
    ...report.local,
    ...report.api,
    ...report.host,
  ];

  const selected = allBackends[selectedIndex];

  return (
    <Box flexDirection="row" gap={2}>
      {/* Left: backend list */}
      <Box flexDirection="column" width={30}>
        <Text bold underline>Backends</Text>
        <ListSelect
          items={allBackends}
          onChange={setSelectedIndex}
          renderItem={(b, _i, isSelected) => (
            <Box gap={1}>
              <Text>{isSelected ? '\u25b8' : ' '}</Text>
              <Badge status={badgeStatus(b)} />
              <Text bold={isSelected}>{b.name}</Text>
              {b.planned && <Text dimColor>[planned]</Text>}
            </Box>
          )}
        />
      </Box>

      {/* Right: detail pane */}
      <Box flexDirection="column" flexGrow={1}>
        {selected && <BackendDetail backend={selected} />}
      </Box>
    </Box>
  );
}

/**
 * Config panel — read-only display of TOML configuration.
 * Inline editing comes in a later task.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { loadConfig, configPaths } from '../config.js';

function ConfigSection({ title, entries }: { title: string; entries: [string, unknown][] }) {
  if (entries.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {entries.map(([key, val]) => (
        <Box key={key} gap={1}>
          <Text>  </Text>
          <Text dimColor>{key}</Text>
          <Text>{String(val)}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function ConfigPanel() {
  const paths = configPaths();
  const config = loadConfig();

  const defaultEntries: [string, unknown][] = [
    ['backend', config.defaults.backend],
    ['sandbox', config.defaults.sandbox],
    ['timeout', config.defaults.timeout],
    ['include_diff', config.defaults.include_diff],
  ];

  const backendSections = Object.entries(config.backends ?? {}).map(([name, cfg]) => ({
    name,
    entries: Object.entries(cfg) as [string, unknown][],
  }));

  return (
    <Box flexDirection="column" gap={1}>
      {/* Config path */}
      <Box>
        <Text dimColor>Config: </Text>
        <Text>{paths.user}</Text>
      </Box>

      {/* Defaults */}
      <ConfigSection title="Defaults" entries={defaultEntries} />

      {/* Per-backend config */}
      {backendSections.map(({ name, entries }) => (
        <ConfigSection key={name} title={`Backend: ${name}`} entries={entries} />
      ))}

      {/* Edit tip */}
      <Box marginTop={1}>
        <Text dimColor>Tip: </Text>
        <Text>phone-a-friend config set {'<key>'} {'<value>'}</Text>
      </Box>
    </Box>
  );
}

/**
 * Persistent status bar showing host integration installation state.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { PluginHostStatus } from '../hooks/usePluginStatus.js';

export interface PluginStatusBarProps {
  installed?: boolean;
  hosts?: PluginHostStatus;
}

function HostLabel({ label, installed }: { label: string; installed: boolean }) {
  return (
    <Text color={installed ? 'green' : 'yellow'}>
      {label} {installed ? '\u2713' : '!'}
    </Text>
  );
}

export function PluginStatusBar({ installed = false, hosts }: PluginStatusBarProps) {
  if (hosts) {
    return (
      <Box marginBottom={1} gap={1}>
        <Text dimColor>Plugins:</Text>
        <HostLabel label="Claude" installed={hosts.claude} />
        <Text dimColor>·</Text>
        <HostLabel label="OpenCode" installed={hosts.opencode} />
      </Box>
    );
  }

  return (
    <Box marginBottom={1}>
      {installed ? (
        <Text color="green">{'\u2713'} Claude Plugin: Installed</Text>
      ) : (
        <Text color="yellow">! Claude Plugin: Not Installed</Text>
      )}
    </Box>
  );
}

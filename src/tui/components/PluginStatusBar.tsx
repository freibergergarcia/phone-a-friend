/**
 * Persistent status bar showing Claude plugin installation state.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface PluginStatusBarProps {
  installed: boolean;
}

export function PluginStatusBar({ installed }: PluginStatusBarProps) {
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

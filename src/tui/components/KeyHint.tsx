/**
 * Footer bar showing context-sensitive keyboard shortcuts.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface Hint {
  key: string;
  label: string;
}

export interface KeyHintProps {
  hints: Hint[];
}

export function KeyHint({ hints }: KeyHintProps) {
  return (
    <Box flexDirection="row" gap={2} marginTop={1}>
      {hints.map(({ key, label }) => (
        <Box key={key}>
          <Text bold color="cyan">{key}</Text>
          <Text dimColor> {label}</Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Horizontal tab bar with active tab highlighting.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface TabBarProps {
  tabs: string[];
  activeIndex: number;
}

export function TabBar({ tabs, activeIndex }: TabBarProps) {
  return (
    <Box flexDirection="row" gap={1} marginBottom={1}>
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        return (
          <Box key={tab}>
            <Text
              bold={isActive}
              inverse={isActive}
              dimColor={!isActive}
            >
              {` ${i + 1} ${tab} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

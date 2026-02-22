/**
 * Root TUI component — tab bar + active panel + keyboard hints.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { TabBar } from './components/TabBar.js';
import { KeyHint } from './components/KeyHint.js';
import type { Hint } from './components/KeyHint.js';

const TABS = ['Status', 'Backends', 'Config', 'Actions'] as const;

const HINTS: Hint[] = [
  { key: 'Tab', label: 'switch' },
  { key: '1-4', label: 'jump' },
  { key: 'r', label: 'refresh' },
  { key: 'q', label: 'quit' },
];

export function App() {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState(0);

  const nextTab = useCallback(() => {
    setActiveTab((prev) => (prev + 1) % TABS.length);
  }, []);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
      return;
    }

    if (key.tab) {
      nextTab();
      return;
    }

    // Number keys 1-4 jump to tabs
    const num = parseInt(input, 10);
    if (num >= 1 && num <= TABS.length) {
      setActiveTab(num - 1);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar tabs={[...TABS]} activeIndex={activeTab} />
      <Box flexDirection="column" minHeight={10}>
        <PanelContent tab={TABS[activeTab]} />
      </Box>
      <KeyHint hints={HINTS} />
    </Box>
  );
}

function PanelContent({ tab }: { tab: string }) {
  return (
    <Box>
      <Text>{tab} Panel</Text>
    </Box>
  );
}

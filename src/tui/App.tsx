/**
 * Root TUI component — tab bar + active panel + keyboard hints.
 * Detection state is lifted here so it persists across tab switches.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { TabBar } from './components/TabBar.js';
import { KeyHint } from './components/KeyHint.js';
import type { Hint } from './components/KeyHint.js';
import { StatusPanel } from './StatusPanel.js';
import { useDetection } from './hooks/useDetection.js';

const TABS = ['Status', 'Backends', 'Config', 'Actions'] as const;

// Global hints (always shown)
const GLOBAL_HINTS: Hint[] = [
  { key: 'Tab', label: 'switch' },
  { key: '1-4', label: 'jump' },
  { key: 'q', label: 'quit' },
];

// Per-tab extra hints
const TAB_HINTS: Record<string, Hint[]> = {
  Status: [{ key: 'r', label: 'refresh' }],
  Backends: [{ key: 'r', label: 'refresh' }],
  Config: [],
  Actions: [],
};

export function App() {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState(0);

  // Detection state lifted here — persists across tab switches
  const detection = useDetection();

  const nextTab = useCallback(() => {
    setActiveTab((prev) => (prev + 1) % TABS.length);
  }, []);

  const currentTab = TABS[activeTab];

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
      return;
    }

    // Panel-specific: r for refresh (Status and Backends tabs)
    if (input === 'r' && (currentTab === 'Status' || currentTab === 'Backends')) {
      detection.refresh({ force: true });
    }
  });

  const hints = [...GLOBAL_HINTS, ...(TAB_HINTS[currentTab] ?? [])];

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar tabs={[...TABS]} activeIndex={activeTab} />
      <Box flexDirection="column" minHeight={10}>
        <PanelContent tab={currentTab} detection={detection} />
      </Box>
      <KeyHint hints={hints} />
    </Box>
  );
}

interface PanelProps {
  tab: string;
  detection: ReturnType<typeof useDetection>;
}

function PanelContent({ tab, detection }: PanelProps) {
  switch (tab) {
    case 'Status':
      return (
        <StatusPanel
          report={detection.report}
          loading={detection.loading}
          refreshing={detection.refreshing}
          error={detection.error}
        />
      );
    case 'Backends':
      return <Text>Backends Panel</Text>;
    case 'Config':
      return <Text>Config Panel</Text>;
    case 'Actions':
      return <Text>Actions Panel</Text>;
    default:
      return null;
  }
}

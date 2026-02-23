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
import { BackendsPanel } from './BackendsPanel.js';
import { ConfigPanel } from './ConfigPanel.js';
import { ActionsPanel } from './ActionsPanel.js';
import { useDetection } from './hooks/useDetection.js';
import { PluginStatusBar } from './components/PluginStatusBar.js';
import { usePluginStatus } from './hooks/usePluginStatus.js';

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
  // When true, a child panel owns keyboard input — global hotkeys are disabled
  const [childHasFocus, setChildHasFocus] = useState(false);

  // Detection state lifted here — persists across tab switches
  const detection = useDetection();
  const pluginStatus = usePluginStatus();

  const nextTab = useCallback(() => {
    setActiveTab((prev) => (prev + 1) % TABS.length);
  }, []);

  const currentTab = TABS[activeTab];

  useInput((input, key) => {
    // When a child panel is in text-edit mode, suppress all global hotkeys
    if (childHasFocus) return;

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
      {activeTab !== 0 && <PluginStatusBar installed={pluginStatus.installed} />}
      <Box flexDirection="column" minHeight={10}>
        <PanelContent tab={currentTab} detection={detection} pluginInstalled={pluginStatus.installed} onPluginRecheck={pluginStatus.recheck} onFocusChange={setChildHasFocus} onExit={() => exit()} />
      </Box>
      <KeyHint hints={hints} />
    </Box>
  );
}

interface PanelProps {
  tab: string;
  detection: ReturnType<typeof useDetection>;
  pluginInstalled: boolean;
  onPluginRecheck: () => void;
  onFocusChange: (hasFocus: boolean) => void;
  onExit: () => void;
}

function PanelContent({ tab, detection, pluginInstalled, onPluginRecheck, onFocusChange, onExit }: PanelProps) {
  switch (tab) {
    case 'Status':
      return (
        <StatusPanel
          report={detection.report}
          loading={detection.loading}
          refreshing={detection.refreshing}
          error={detection.error}
          pluginInstalled={pluginInstalled}
        />
      );
    case 'Backends':
      return <BackendsPanel report={detection.report} onEditingChange={onFocusChange} />;
    case 'Config':
      return <ConfigPanel onEditingChange={onFocusChange} />;
    case 'Actions':
      return <ActionsPanel report={detection.report} onRefresh={() => detection.refresh({ force: true })} onPluginRecheck={onPluginRecheck} onExit={onExit} />;
    default:
      return null;
  }
}

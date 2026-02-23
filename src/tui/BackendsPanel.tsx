/**
 * Backends panel — navigable list of all backends with detail pane.
 * Ollama model picker: press Enter on Ollama to select a default model.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Badge } from './components/Badge.js';
import type { BadgeStatus } from './components/Badge.js';
import { ListSelect } from './components/ListSelect.js';
import type { DetectionReport, BackendStatus } from '../detection.js';
import { loadConfig, configPaths, configSet, configInit } from '../config.js';
import { existsSync } from 'node:fs';

function badgeStatus(b: BackendStatus): BadgeStatus {
  if (b.planned) return 'planned';
  if (b.available) return 'available';
  if (b.name === 'ollama' && (b.models !== undefined || b.installHint === 'ollama serve')) return 'partial';
  return 'unavailable';
}

type PanelMode = 'nav' | 'modelSelect';

function BackendDetail({
  backend,
  config,
  mode,
  modelSelectedIndex,
  onModelSelectedIndexChange,
}: {
  backend: BackendStatus;
  config: ReturnType<typeof loadConfig>;
  mode: PanelMode;
  modelSelectedIndex: number;
  onModelSelectedIndexChange: (index: number) => void;
}) {
  const backendConfig = config.backends?.[backend.name];
  const configuredModel = config.backends?.ollama?.model as string | undefined;
  const isOllama = backend.name === 'ollama';
  const models = backend.models ?? [];
  const hasModels = models.length > 0;

  // Check for mismatch: configured model not in detected list
  const modelMismatch = isOllama && configuredModel && hasModels && !models.includes(configuredModel);

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

      {/* Models (Ollama) — nav mode: read-only list */}
      {isOllama && hasModels && mode === 'nav' && (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={2}>
            <Text bold>Models:</Text>
            <Text dimColor>Enter to pick default</Text>
          </Box>
          {models.map((m) => (
            <Text key={m}>
              {'  '}{m}{configuredModel === m ? '  \u2605 (default)' : ''}
            </Text>
          ))}
          {modelMismatch && (
            <Text color="yellow">{'\u26A0'} Configured model &quot;{configuredModel}&quot; not detected</Text>
          )}
        </Box>
      )}

      {/* Models (Ollama) — modelSelect mode: interactive picker */}
      {isOllama && hasModels && mode === 'modelSelect' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Select default model:</Text>
          <ListSelect
            items={models}
            isActive={true}
            selectedIndex={modelSelectedIndex}
            onChange={onModelSelectedIndexChange}
            getKey={(m) => m}
            renderItem={(m, _i, isSelected) => (
              <Box gap={1}>
                <Text>{isSelected ? '\u25b8' : ' '}</Text>
                <Text bold={isSelected}>{m}</Text>
                {configuredModel === m && <Text color="green">{' \u2605'}</Text>}
              </Box>
            )}
          />
          <Box marginTop={1}>
            <Text dimColor>Enter select  Esc cancel</Text>
          </Box>
        </Box>
      )}

      {/* Ollama server reachable but 0 models */}
      {isOllama && backend.models !== undefined && models.length === 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>No models pulled. Run: ollama pull &lt;model-name&gt;</Text>
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
  onEditingChange?: (editing: boolean) => void;
}

export function BackendsPanel({ report, onEditingChange }: BackendsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<PanelMode>('nav');
  const [modelSelectedIndex, setModelSelectedIndex] = useState(0);
  const [config, setConfig] = useState(() => loadConfig());
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Cleanup: ensure focus is released if component unmounts while in modelSelect
  useEffect(() => {
    return () => {
      if (mode === 'modelSelect') {
        onEditingChange?.(false);
      }
    };
  }, [mode, onEditingChange]);

  const enterModelSelect = useCallback((models: string[]) => {
    const configuredModel = config.backends?.ollama?.model as string | undefined;
    const preselect = configuredModel ? models.indexOf(configuredModel) : -1;
    setModelSelectedIndex(preselect >= 0 ? preselect : 0);
    setMode('modelSelect');
    setSaveMessage(null);
    onEditingChange?.(true);
  }, [config, onEditingChange]);

  const exitModelSelect = useCallback(() => {
    setMode('nav');
    onEditingChange?.(false);
  }, [onEditingChange]);

  const saveModel = useCallback((modelName: string) => {
    try {
      const paths = configPaths();
      const userPath = paths.user;
      if (!existsSync(userPath)) {
        configInit(userPath, true);
      }
      configSet('backends.ollama.model', modelName, userPath);
      setConfig(loadConfig());
      setSaveMessage(`Default model set to ${modelName}`);
    } catch (err) {
      setSaveMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    exitModelSelect();
  }, [exitModelSelect]);

  // Handle Enter in nav mode and Enter/Escape in modelSelect mode
  useInput((input, key) => {
    if (mode === 'modelSelect') {
      if (key.return) {
        const allBackends = report ? [...report.cli, ...report.local, ...report.host] : [];
        const selected = allBackends[selectedIndex];
        const models = selected?.models ?? [];
        const model = models[modelSelectedIndex];
        if (model) saveModel(model);
        return;
      }
      if (key.escape) {
        exitModelSelect();
        return;
      }
      // Arrow keys handled by inner ListSelect
      return;
    }

    // Nav mode: Enter on Ollama with models → enter model select
    if (key.return) {
      const allBackends = report ? [...report.cli, ...report.local, ...report.host] : [];
      const selected = allBackends[selectedIndex];
      if (selected?.name === 'ollama' && (selected.models?.length ?? 0) > 0) {
        enterModelSelect(selected.models!);
      }
    }
  }, { isActive: mode === 'nav' || mode === 'modelSelect' });

  if (!report) {
    return <Text color="cyan">Loading backends...</Text>;
  }

  // Flatten all backends into one list
  const allBackends = [
    ...report.cli,
    ...report.local,
    ...report.host,
  ];

  const selected = allBackends[selectedIndex];

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        {/* Left: backend list */}
        <Box flexDirection="column" width={30}>
          <Text bold underline>Backends</Text>
          <ListSelect
            items={allBackends}
            onChange={setSelectedIndex}
            isActive={mode === 'nav'}
            getKey={(b) => b.name}
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
          {selected && (
            <BackendDetail
              backend={selected}
              config={config}
              mode={mode}
              modelSelectedIndex={modelSelectedIndex}
              onModelSelectedIndexChange={setModelSelectedIndex}
            />
          )}
        </Box>
      </Box>

      {/* Save message */}
      {saveMessage && (
        <Box marginTop={1}>
          <Text color={saveMessage.startsWith('Error') ? 'red' : 'green'}>{saveMessage}</Text>
        </Box>
      )}
    </Box>
  );
}

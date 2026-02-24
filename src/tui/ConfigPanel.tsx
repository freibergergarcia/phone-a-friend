/**
 * Config panel — navigable config display with inline editing.
 * Editing targets user config file only (never repo config).
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { loadConfig, configPaths, configSet, configInit } from '../config.js';
import { existsSync } from 'node:fs';
import { INSTALL_HINTS } from '../backends/index.js';

type EditMode =
  | { type: 'toggle' }
  | { type: 'picker'; options: string[] }
  | { type: 'text' };

interface ConfigRow {
  dotKey: string;
  label: string;
  value: unknown;
  section: string;
  editMode: EditMode;
}

const SANDBOX_OPTIONS: string[] = ['read-only', 'workspace-write', 'danger-full-access'];

function buildRows(config: ReturnType<typeof loadConfig>): ConfigRow[] {
  const rows: ConfigRow[] = [];
  const backendOptions = Object.keys(INSTALL_HINTS).sort();

  // Defaults
  rows.push({ dotKey: 'defaults.backend', label: 'backend', value: config.defaults.backend, section: 'Defaults', editMode: { type: 'picker', options: backendOptions } });
  rows.push({ dotKey: 'defaults.sandbox', label: 'sandbox', value: config.defaults.sandbox, section: 'Defaults', editMode: { type: 'picker', options: SANDBOX_OPTIONS } });
  rows.push({ dotKey: 'defaults.timeout', label: 'timeout', value: config.defaults.timeout, section: 'Defaults', editMode: { type: 'text' } });
  rows.push({ dotKey: 'defaults.include_diff', label: 'include_diff', value: config.defaults.include_diff, section: 'Defaults', editMode: { type: 'toggle' } });
  rows.push({ dotKey: 'defaults.stream', label: 'stream', value: config.defaults.stream ?? true, section: 'Defaults', editMode: { type: 'toggle' } });

  // Per-backend (all free-text)
  for (const [name, cfg] of Object.entries(config.backends ?? {})) {
    for (const [key, val] of Object.entries(cfg)) {
      rows.push({ dotKey: `backends.${name}.${key}`, label: key, value: val, section: `Backend: ${name}`, editMode: { type: 'text' } });
    }
  }

  return rows;
}

export interface ConfigPanelProps {
  onEditingChange?: (editing: boolean) => void;
}

export function ConfigPanel({ onEditingChange }: ConfigPanelProps = {}) {
  const paths = configPaths();
  const [config, setConfig] = useState(() => loadConfig());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setModeRaw] = useState<'nav' | 'text' | 'picker'>('nav');
  const [editValue, setEditValue] = useState('');
  const [pickerOptions, setPickerOptions] = useState<string[]>([]);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const setMode = useCallback((value: 'nav' | 'text' | 'picker') => {
    setModeRaw(value);
    onEditingChange?.(value !== 'nav');
  }, [onEditingChange]);

  const rows = buildRows(config);

  const reload = useCallback(() => {
    setConfig(loadConfig());
    setSaveMessage(null);
  }, []);

  const save = useCallback((dotKey: string, value: string) => {
    try {
      const userPath = paths.user;
      if (!existsSync(userPath)) {
        configInit(userPath, true);
      }
      configSet(dotKey, value, userPath);
      reload();
      setSaveMessage(`Saved ${dotKey}`);
    } catch (err) {
      setSaveMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [paths.user, reload]);

  useInput((input, key) => {
    // Picker mode
    if (mode === 'picker') {
      if (key.return) {
        const row = rows[selectedIndex];
        const selected = pickerOptions[pickerIndex];
        if (!row || !selected) { setMode('nav'); return; }
        save(row.dotKey, selected);
        setMode('nav');
        return;
      }
      if (key.escape) {
        setMode('nav');
        return;
      }
      if (key.downArrow) {
        setPickerIndex((i) => Math.min(i + 1, pickerOptions.length - 1));
        return;
      }
      if (key.upArrow) {
        setPickerIndex((i) => Math.max(i - 1, 0));
        return;
      }
      return;
    }

    // Text edit mode
    if (mode === 'text') {
      if (key.return) {
        const row = rows[selectedIndex];
        if (!row) { setMode('nav'); return; }
        save(row.dotKey, editValue);
        setMode('nav');
        return;
      }
      if (key.escape) {
        setMode('nav');
        return;
      }
      if (key.backspace || key.delete) {
        setEditValue((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditValue((v) => v + input);
      }
      return;
    }

    // Navigation mode
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(i + 1, rows.length - 1));
      setSaveMessage(null);
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      setSaveMessage(null);
    }
    if (key.return) {
      const row = rows[selectedIndex];
      if (!row) return;

      if (row.editMode.type === 'toggle') {
        const newValue = String(row.value) === 'true' ? 'false' : 'true';
        save(row.dotKey, newValue);
        return;
      }

      if (row.editMode.type === 'picker') {
        const options = row.editMode.options;
        const currentIdx = options.indexOf(String(row.value));
        setPickerOptions(options);
        setPickerIndex(currentIdx >= 0 ? currentIdx : 0);
        setMode('picker');
        setSaveMessage(null);
        return;
      }

      // Free-text
      setEditValue(String(row.value));
      setMode('text');
      setSaveMessage(null);
    }
    if (input === 'r') {
      reload();
    }
  });

  let lastSection = '';

  return (
    <Box flexDirection="column" gap={0}>
      {/* Config path */}
      <Box marginBottom={1}>
        <Text dimColor>Config: </Text>
        <Text>{paths.user}</Text>
      </Box>

      {/* Rows */}
      {rows.map((row, i) => {
        const showSection = row.section !== lastSection;
        lastSection = row.section;
        const isSelected = i === selectedIndex;
        const isTextEditing = isSelected && mode === 'text';
        const isPickerOpen = isSelected && mode === 'picker';

        return (
          <Box key={row.dotKey} flexDirection="column">
            {showSection && (
              <Box marginTop={i > 0 ? 1 : 0}>
                <Text bold>{row.section}</Text>
              </Box>
            )}
            <Box gap={1}>
              <Text>{isSelected ? '\u25b8' : ' '}</Text>
              <Text dimColor>{row.label.padEnd(14)}</Text>
              {isTextEditing ? (
                <Text color="cyan">{editValue}<Text inverse> </Text></Text>
              ) : (
                <Text bold={isSelected}>{String(row.value)}</Text>
              )}
            </Box>
            {isPickerOpen && (
              <Box flexDirection="column" paddingLeft={2}>
                {pickerOptions.map((opt, pi) => (
                  <Box key={opt} gap={1}>
                    <Text>{pi === pickerIndex ? '\u25b8' : ' '}</Text>
                    <Text bold={pi === pickerIndex} color={pi === pickerIndex ? 'cyan' : undefined}>{opt}</Text>
                    {String(row.value) === opt && <Text dimColor> (current)</Text>}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      })}

      {/* Save message */}
      {saveMessage && (
        <Box marginTop={1}>
          <Text color={saveMessage.startsWith('Error') ? 'red' : 'green'}>{saveMessage}</Text>
        </Box>
      )}

      {/* Hints */}
      <Box marginTop={1}>
        {mode === 'picker' ? (
          <Text dimColor>Enter select  Esc cancel  Arrow keys navigate</Text>
        ) : mode === 'text' ? (
          <Text dimColor>Enter save  Esc cancel  Backspace delete</Text>
        ) : (
          <Text dimColor>Enter edit  Arrow keys navigate  r reload</Text>
        )}
      </Box>
    </Box>
  );
}

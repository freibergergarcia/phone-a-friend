/**
 * Config panel — navigable config display with inline editing.
 * Editing targets user config file only (never repo config).
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { loadConfig, configPaths, configSet } from '../config.js';
import { existsSync } from 'node:fs';

interface ConfigRow {
  dotKey: string;
  label: string;
  value: unknown;
  section: string;
}

function buildRows(config: ReturnType<typeof loadConfig>): ConfigRow[] {
  const rows: ConfigRow[] = [];

  // Defaults
  rows.push({ dotKey: 'defaults.backend', label: 'backend', value: config.defaults.backend, section: 'Defaults' });
  rows.push({ dotKey: 'defaults.sandbox', label: 'sandbox', value: config.defaults.sandbox, section: 'Defaults' });
  rows.push({ dotKey: 'defaults.timeout', label: 'timeout', value: config.defaults.timeout, section: 'Defaults' });
  rows.push({ dotKey: 'defaults.include_diff', label: 'include_diff', value: config.defaults.include_diff, section: 'Defaults' });

  // Per-backend
  for (const [name, cfg] of Object.entries(config.backends ?? {})) {
    for (const [key, val] of Object.entries(cfg)) {
      rows.push({ dotKey: `backends.${name}.${key}`, label: key, value: val, section: `Backend: ${name}` });
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
  const [editing, setEditingRaw] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const setEditing = useCallback((value: boolean) => {
    setEditingRaw(value);
    onEditingChange?.(value);
  }, [onEditingChange]);

  const rows = buildRows(config);

  const reload = useCallback(() => {
    setConfig(loadConfig());
    setSaveMessage(null);
  }, []);

  useInput((input, key) => {
    if (editing) {
      if (key.return) {
        // Save
        const row = rows[selectedIndex];
        if (!row) { setEditing(false); return; }
        try {
          const userPath = paths.user;
          if (!existsSync(userPath)) {
            // Create default config first
            const { configInit } = require('../config.js');
            configInit(userPath, true);
          }
          configSet(row.dotKey, editValue, userPath);
          reload();
          setSaveMessage(`Saved ${row.dotKey}`);
        } catch (err) {
          setSaveMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        setEditing(false);
        return;
      }
      if (key.escape) {
        setEditing(false);
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
      setEditValue(String(row.value));
      setEditing(true);
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
        const isEditing = isSelected && editing;

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
              {isEditing ? (
                <Text color="cyan">{editValue}<Text inverse> </Text></Text>
              ) : (
                <Text bold={isSelected}>{String(row.value)}</Text>
              )}
            </Box>
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
        {editing ? (
          <Text dimColor>Enter save  Esc cancel  Backspace delete</Text>
        ) : (
          <Text dimColor>Enter edit  Arrow keys navigate  r reload</Text>
        )}
      </Box>
    </Box>
  );
}

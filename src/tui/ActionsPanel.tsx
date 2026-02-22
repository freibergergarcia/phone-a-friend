/**
 * Actions panel — executable actions with async wrappers.
 *
 * CRITICAL: relay() and installHosts() use execFileSync which blocks.
 * Actions that call sync-blocking functions use child_process.spawn()
 * to avoid freezing the TUI.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { detectAll } from '../detection.js';
import { configPaths } from '../config.js';
import type { DetectionReport } from '../detection.js';

interface Action {
  label: string;
  description: string;
  run: () => Promise<string>;
  disabled?: string;
}

function buildActions(report: DetectionReport | null, onRefresh: () => void): Action[] {
  return [
    {
      label: 'Check Backends',
      description: 'Re-scan all backends',
      run: async () => {
        const result = await detectAll();
        const allRelay = [...result.cli, ...result.local, ...result.api];
        const available = allRelay.filter((b) => b.available && !b.planned).length;
        const total = allRelay.filter((b) => !b.planned).length;
        onRefresh();
        return `${available} of ${total} relay backends ready`;
      },
    },
    {
      label: 'Reinstall Plugin',
      description: 'Reinstall Claude Code plugin',
      run: async () => {
        return new Promise<string>((resolve, reject) => {
          const proc = spawn(process.execPath, [process.argv[1] ?? 'phone-a-friend', 'plugin', 'install', '--claude'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let output = '';
          proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
          proc.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
          proc.on('close', (code) => {
            if (code === 0) resolve(output.trim() || 'Plugin reinstalled');
            else reject(new Error(output.trim() || `Exit code ${code}`));
          });
          proc.on('error', (err) => reject(err));
        });
      },
    },
    {
      label: 'Open Config',
      description: 'Open config in $EDITOR',
      run: async () => {
        const paths = configPaths();
        const editor = process.env.EDITOR ?? 'vi';
        return new Promise<string>((resolve, reject) => {
          const proc = spawn(editor, [paths.user], { stdio: 'inherit' });
          proc.on('close', () => resolve('Editor closed'));
          proc.on('error', (err) => reject(err));
        });
      },
    },
  ];
}

export interface ActionsPanelProps {
  report: DetectionReport | null;
  onRefresh: () => void;
}

export function ActionsPanel({ report, onRefresh }: ActionsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const actions = buildActions(report, onRefresh);

  useInput((_input, key) => {
    if (running) return;

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(i + 1, actions.length - 1));
      setResult(null);
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      setResult(null);
    }
    if (key.return) {
      const action = actions[selectedIndex];
      if (action.disabled) return;

      setRunning(true);
      setResult(null);
      action.run()
        .then((msg) => {
          setResult({ success: true, message: msg });
        })
        .catch((err) => {
          setResult({ success: false, message: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          setRunning(false);
        });
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold underline>Actions</Text>

      <Box flexDirection="column">
        {actions.map((action, i) => {
          const isSelected = i === selectedIndex;
          const isDisabled = !!action.disabled;
          return (
            <Box key={action.label} gap={1}>
              <Text>{isSelected ? '\u25b8' : ' '}</Text>
              <Text bold={isSelected} dimColor={isDisabled}>{action.label}</Text>
              <Text dimColor>{action.description}</Text>
              {isDisabled && <Text color="yellow">({action.disabled})</Text>}
            </Box>
          );
        })}
      </Box>

      {running && <Text color="cyan">Running...</Text>}

      {result && (
        <Box marginTop={1}>
          <Text color={result.success ? 'green' : 'red'}>
            {result.success ? '\u2713' : '\u2717'} {result.message}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Enter to run  Arrow keys to navigate</Text>
      </Box>
    </Box>
  );
}

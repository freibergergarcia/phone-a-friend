/**
 * Actions panel — executable actions with async wrappers.
 *
 * CRITICAL: relay() and installHosts() use execFileSync which blocks.
 * Actions that call sync-blocking functions use child_process.spawn()
 * to avoid freezing the TUI.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { detectAll } from '../detection.js';
import { configPaths, configInit } from '../config.js';
import type { DetectionReport } from '../detection.js';

interface Action {
  label: string;
  description: string;
  run: () => Promise<string>;
  disabled?: string;
}

function buildActions(
  report: DetectionReport | null,
  onRefresh: () => void,
  processRef: React.MutableRefObject<ChildProcess | null>,
): Action[] {
  return [
    {
      label: 'Check Backends',
      description: 'Re-scan all backends',
      run: async () => {
        // Only trigger parent refresh — avoids double detection work
        onRefresh();
        return 'Backend re-scan triggered';
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
          processRef.current = proc;
          let output = '';
          proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
          proc.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
          proc.on('close', (code) => {
            processRef.current = null;
            if (code === 0) resolve(output.trim() || 'Plugin reinstalled');
            else reject(new Error(output.trim() || `Exit code ${code}`));
          });
          proc.on('error', (err) => { processRef.current = null; reject(err); });
        });
      },
    },
    {
      label: 'Open Config',
      description: 'Open config in $EDITOR',
      run: async () => {
        const paths = configPaths();
        // Ensure config file exists before opening editor
        if (!existsSync(paths.user)) {
          mkdirSync(dirname(paths.user), { recursive: true });
          configInit(paths.user, true);
        }
        const editorEnv = process.env.EDITOR ?? 'vi';
        // Handle editors with args (e.g. "code -w", "nvim -u ...")
        const parts = editorEnv.split(/\s+/);
        const editor = parts[0];
        const editorArgs = [...parts.slice(1), paths.user];
        return new Promise<string>((resolve, reject) => {
          const proc = spawn(editor, editorArgs, { stdio: 'inherit' });
          processRef.current = proc;
          proc.on('close', () => { processRef.current = null; resolve('Editor closed'); });
          proc.on('error', (err) => { processRef.current = null; reject(err); });
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
  const mountedRef = useRef(true);
  const activeProcessRef = useRef<ChildProcess | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Kill any orphan child process on unmount
      if (activeProcessRef.current) {
        activeProcessRef.current.kill();
        activeProcessRef.current = null;
      }
    };
  }, []);

  const actions = buildActions(report, onRefresh, activeProcessRef);

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
          if (!mountedRef.current) return;
          setResult({ success: true, message: msg });
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setResult({ success: false, message: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          if (!mountedRef.current) return;
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

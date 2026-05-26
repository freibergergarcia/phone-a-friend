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
import { detectAll, decorateOpenCodeModels } from '../detection.js';
import { configPaths, configInit } from '../config.js';
import type { DetectionReport, BackendStatus } from '../detection.js';
import { isCodexInstalled, isOpenCodeInstalled, isPluginInstalled } from '../installer.js';

interface Action {
  label: string;
  description: string;
  run: () => Promise<string>;
  disabled?: string;
  confirm?: string; // If set, show this prompt before running
  exitAfter?: boolean; // If true, exit TUI after successful run
}

interface ActionGroup {
  /** Header label rendered above the group. */
  title: string;
  /** Optional installed-state badge state for host groups. */
  installed?: boolean;
  actions: Action[];
}

/**
 * Build a compact multi-line backend status summary for the "Check Backends"
 * action result panel. One line per backend with ✓/✗, plus a host install
 * status line. Kept terse so it fits in the action result area without
 * scrolling.
 */
function formatBackendSummary(report: DetectionReport): string {
  const lines: string[] = [];
  const mark = (b: BackendStatus) => (b.available ? '✓' : '✗');

  const relay: BackendStatus[] = [...report.cli, ...report.local];
  const ready = relay.filter((b) => b.available && !b.planned).length;
  const total = relay.filter((b) => !b.planned && !(b.optional && !b.available)).length;
  lines.push(`Backend re-scan complete — ${ready} of ${total} relay backends ready`);
  lines.push('');
  lines.push('Relay backends:');
  for (const b of relay) {
    if (b.planned) continue;
    lines.push(`  ${mark(b)} ${b.name.padEnd(10)} ${b.detail}`);
  }
  lines.push('');
  lines.push('Host integrations:');
  for (const h of report.host) {
    lines.push(`  ${mark(h)} ${h.name.padEnd(10)} ${h.detail}`);
  }
  lines.push('');
  lines.push('Host installs:');
  const claudeInstalled = isPluginInstalled();
  const opencodeInstalled = isOpenCodeInstalled();
  const codexInstalled = isCodexInstalled();
  lines.push(`  ${claudeInstalled ? '✓' : '!'} claude     ${claudeInstalled ? 'installed' : 'not installed'}`);
  lines.push(`  ${opencodeInstalled ? '✓' : '!'} opencode   ${opencodeInstalled ? 'installed' : 'not installed'}`);
  lines.push(`  ${codexInstalled ? '✓' : '!'} codex      ${codexInstalled ? 'installed' : 'not installed'}`);

  return lines.join('\n');
}

/**
 * Spawn `phone-a-friend ...args` and resolve with combined stdout/stderr.
 * All Install/Uninstall actions go through this so they share the same
 * subprocess shape (and so we don't duplicate the boilerplate per action).
 */
function spawnPaf(
  args: string[],
  processRef: React.MutableRefObject<ChildProcess | null>,
  fallbackMessage: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(process.execPath, [process.argv[1] ?? 'phone-a-friend', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processRef.current = proc;
    let output = '';
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    proc.on('close', (code) => {
      processRef.current = null;
      if (code === 0) resolve(output.trim() || fallbackMessage);
      else reject(new Error(output.trim() || `Exit code ${code}`));
    });
    proc.on('error', (err) => { processRef.current = null; reject(err); });
  });
}

function buildActionGroups(
  report: DetectionReport | null,
  onRefresh: () => void,
  processRef: React.MutableRefObject<ChildProcess | null>,
): ActionGroup[] {
  const claudeInstalled = isPluginInstalled();
  const opencodeInstalled = isOpenCodeInstalled();
  const codexInstalled = isCodexInstalled();

  return [
    {
      title: 'Diagnostics',
      actions: [
        {
          label: 'Check Backends',
          description: 'Re-scan all backends and report status',
          run: async () => {
            const fresh = await detectAll();
            decorateOpenCodeModels(fresh);
            onRefresh();
            return formatBackendSummary(fresh);
          },
        },
        {
          label: 'Open Config',
          description: 'Edit config in $EDITOR',
          run: async () => {
            const paths = configPaths();
            if (!existsSync(paths.user)) {
              mkdirSync(dirname(paths.user), { recursive: true });
              configInit(paths.user, true);
            }
            const editorEnv = process.env.EDITOR ?? 'vi';
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
      ],
    },
    {
      title: 'Claude Code',
      installed: claudeInstalled,
      actions: [
        {
          label: claudeInstalled ? 'Reinstall' : 'Install',
          description: claudeInstalled
            ? 'Refresh symlink + marketplace registration'
            : 'Install Claude plugin + marketplace registration',
          run: () =>
            // --force makes the action idempotent regardless of current state
            // (symlink target moved, copy install, partial state, etc).
            spawnPaf(
              ['plugin', 'install', '--claude', '--force'],
              processRef,
              'Claude plugin installed',
            ),
        },
        {
          label: 'Uninstall',
          description: 'Remove plugin + marketplace registration',
          confirm: 'Uninstall Claude plugin and exit? (y/n)',
          exitAfter: true,
          run: () =>
            spawnPaf(['plugin', 'uninstall', '--claude'], processRef, 'Claude plugin uninstalled'),
        },
      ],
    },
    {
      title: 'OpenCode',
      installed: opencodeInstalled,
      actions: [
        {
          label: opencodeInstalled ? 'Reinstall' : 'Install',
          description: opencodeInstalled
            ? 'Refresh skills + command shims'
            : 'Install skills + command shims',
          run: () =>
            spawnPaf(
              ['plugin', 'install', '--opencode', '--force', '--no-claude-cli-sync'],
              processRef,
              'OpenCode skills + commands installed',
            ),
        },
        {
          label: 'Uninstall',
          description: 'Remove skills + command shims',
          confirm: 'Uninstall OpenCode skills + commands? (y/n)',
          run: () =>
            spawnPaf(
              ['plugin', 'uninstall', '--opencode'],
              processRef,
              'OpenCode skills + commands uninstalled',
            ),
        },
      ],
    },
    {
      title: 'Codex',
      installed: codexInstalled,
      actions: [
        {
          label: codexInstalled ? 'Reinstall' : 'Install',
          description: codexInstalled
            ? 'Refresh skills + marketplace registration'
            : 'Install skills + marketplace registration',
          run: () =>
            spawnPaf(
              ['plugin', 'install', '--codex', '--force', '--no-claude-cli-sync'],
              processRef,
              'Codex plugin installed',
            ),
        },
        {
          label: 'Uninstall',
          description: 'Remove skills + marketplace registration (and any stale paf-* subagent symlinks)',
          confirm: 'Uninstall Codex plugin? (y/n)',
          run: () =>
            spawnPaf(['plugin', 'uninstall', '--codex'], processRef, 'Codex plugin uninstalled'),
        },
      ],
    },
  ];
}

/** Flatten groups to a list of {groupIndex, actionIndex, action} for selection. */
function flattenActions(groups: ActionGroup[]): Array<{
  groupIndex: number;
  actionIndex: number;
  action: Action;
}> {
  const flat: Array<{ groupIndex: number; actionIndex: number; action: Action }> = [];
  for (let gi = 0; gi < groups.length; gi++) {
    for (let ai = 0; ai < groups[gi].actions.length; ai++) {
      flat.push({ groupIndex: gi, actionIndex: ai, action: groups[gi].actions[ai] });
    }
  }
  return flat;
}

export interface ActionsPanelProps {
  report: DetectionReport | null;
  onRefresh: () => void;
  onPluginRecheck: () => void;
  onExit: () => void;
}

export function ActionsPanel({ report, onRefresh, onPluginRecheck, onExit }: ActionsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const mountedRef = useRef(true);
  const activeProcessRef = useRef<ChildProcess | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (activeProcessRef.current) {
        activeProcessRef.current.kill();
        activeProcessRef.current = null;
      }
    };
  }, []);

  const groups = buildActionGroups(report, onRefresh, activeProcessRef);
  const flat = flattenActions(groups);
  const actions = flat.map((f) => f.action);

  const executeAction = (action: Action) => {
    setRunning(true);
    setConfirming(false);
    setResult(null);
    action.run()
      .then((msg) => {
        if (!mountedRef.current) return;
        setResult({ success: true, message: msg });
        // Refresh plugin status bar after install/uninstall actions
        onPluginRecheck();
        if (action.exitAfter) {
          // Keep running=true to lock input until exit fires
          setTimeout(() => { if (mountedRef.current) onExit(); }, 800);
          return;
        }
        setRunning(false);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setResult({ success: false, message: err instanceof Error ? err.message : String(err) });
        setRunning(false);
      });
  };

  useInput((input, key) => {
    if (running) return;

    // Confirmation mode: y/n/Escape
    if (confirming) {
      if (input === 'y' || input === 'Y') {
        executeAction(actions[selectedIndex]);
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setConfirming(false);
      }
      return;
    }

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

      if (action.confirm) {
        setConfirming(true);
        setResult(null);
      } else {
        executeAction(action);
      }
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold underline>Actions</Text>

      <Box flexDirection="column">
        {groups.map((group, gi) => {
          const groupHasSelection = flat[selectedIndex]?.groupIndex === gi;
          return (
            <Box key={group.title} flexDirection="column" marginBottom={1}>
              <Box gap={1}>
                <Text bold color={groupHasSelection ? 'cyan' : undefined}>
                  {group.title}
                </Text>
                {group.installed === true && <Text color="green">{'\u2713 installed'}</Text>}
                {group.installed === false && <Text color="yellow">{'! not installed'}</Text>}
              </Box>
              {group.actions.map((action, ai) => {
                const flatIndex = flat.findIndex(
                  (f) => f.groupIndex === gi && f.actionIndex === ai,
                );
                const isSelected = flatIndex === selectedIndex;
                const isDisabled = !!action.disabled;
                return (
                  <Box key={action.label} gap={1} paddingLeft={2}>
                    <Text>{isSelected ? '\u25b8' : ' '}</Text>
                    <Text bold={isSelected} dimColor={isDisabled}>{action.label}</Text>
                    <Text dimColor>{action.description}</Text>
                    {isDisabled && <Text color="yellow">({action.disabled})</Text>}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {confirming && (
        <Box marginTop={1}>
          <Text color="yellow">{actions[selectedIndex]?.confirm}</Text>
        </Box>
      )}

      {running && <Text color="cyan">Running...</Text>}

      {result && (
        <Box marginTop={1} flexDirection="column">
          {(() => {
            const lines = result.message.split('\n');
            const head = lines[0] ?? '';
            const tail = lines.slice(1);
            return (
              <>
                <Text color={result.success ? 'green' : 'red'}>
                  {result.success ? '\u2713' : '\u2717'} {head}
                </Text>
                {tail.map((line, i) => (
                  <Text key={i} color={result.success ? undefined : 'red'}>
                    {line}
                  </Text>
                ))}
              </>
            );
          })()}
        </Box>
      )}

      <Box marginTop={1}>
        {confirming ? (
          <Text dimColor>y confirm  n/Esc cancel</Text>
        ) : (
          <Text dimColor>Enter to run  Arrow keys to navigate</Text>
        )}
      </Box>
    </Box>
  );
}

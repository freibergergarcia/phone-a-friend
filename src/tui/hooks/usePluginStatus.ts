/**
 * Hook for tracking host integration installation status.
 * Performs a cheap sync FS check on mount and exposes recheck().
 */

import { useState, useCallback } from 'react';
import { isCodexInstalled, isOpenCodeInstalled, isPluginInstalled } from '../../installer.js';

export interface PluginHostStatus {
  claude: boolean;
  opencode: boolean;
  codex: boolean;
}

export interface UsePluginStatusResult {
  /** Backward-compatible alias for Claude plugin installation state. */
  installed: boolean;
  hosts: PluginHostStatus;
  recheck: () => void;
}

function readStatus(): PluginHostStatus {
  return {
    claude: isPluginInstalled(),
    opencode: isOpenCodeInstalled(),
    codex: isCodexInstalled(),
  };
}

export function usePluginStatus(): UsePluginStatusResult {
  const [hosts, setHosts] = useState(readStatus);

  const recheck = useCallback(() => {
    setHosts(readStatus());
  }, []);

  return { installed: hosts.claude, hosts, recheck };
}

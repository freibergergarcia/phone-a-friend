/**
 * Hook for tracking host integration installation status.
 * Performs a cheap sync FS check on mount and exposes recheck().
 */

import { useState, useCallback } from 'react';
import { isOpenCodeInstalled, isPluginInstalled } from '../../installer.js';

export interface PluginHostStatus {
  claude: boolean;
  opencode: boolean;
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
  };
}

export function usePluginStatus(): UsePluginStatusResult {
  const [hosts, setHosts] = useState(readStatus);

  const recheck = useCallback(() => {
    setHosts(readStatus());
  }, []);

  return { installed: hosts.claude, hosts, recheck };
}

/**
 * Hook for tracking Claude plugin installation status.
 * Performs a cheap sync FS check on mount and exposes recheck().
 */

import { useState, useCallback } from 'react';
import { isPluginInstalled } from '../../installer.js';

export interface UsePluginStatusResult {
  installed: boolean;
  recheck: () => void;
}

export function usePluginStatus(): UsePluginStatusResult {
  const [installed, setInstalled] = useState(() => isPluginInstalled());

  const recheck = useCallback(() => {
    setInstalled(isPluginInstalled());
  }, []);

  return { installed, recheck };
}

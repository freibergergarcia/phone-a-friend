/**
 * Hook wrapping detectAll() with loading/error state and throttled refresh.
 * Supports force refresh to bypass throttle for manual user action.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { detectAll } from '../../detection.js';
import type { DetectionReport } from '../../detection.js';

const THROTTLE_MS = 5000;

export interface UseDetectionResult {
  report: DetectionReport | null;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refresh: (opts?: { force?: boolean }) => void;
}

export function useDetection(): UseDetectionResult {
  const [report, setReport] = useState<DetectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runDetection = useCallback(async (force = false) => {
    if (runningRef.current) return;
    const now = Date.now();
    if (!force && now - lastRunRef.current < THROTTLE_MS && lastRunRef.current > 0) return;

    runningRef.current = true;
    // Only show full loading on initial load, otherwise show refreshing
    if (report === null) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const result = await detectAll();
      if (mountedRef.current) {
        setReport(result);
        lastRunRef.current = Date.now();
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      runningRef.current = false;
    }
  }, [report]);

  useEffect(() => {
    runDetection();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback((opts?: { force?: boolean }) => {
    runDetection(opts?.force ?? false);
  }, [runDetection]);

  return { report, loading, refreshing, error, refresh };
}

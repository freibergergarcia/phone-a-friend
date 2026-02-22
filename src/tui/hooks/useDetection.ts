/**
 * Hook wrapping detectAll() with loading state and throttled refresh.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { detectAll } from '../../detection.js';
import type { DetectionReport } from '../../detection.js';

const THROTTLE_MS = 5000;

export interface UseDetectionResult {
  report: DetectionReport | null;
  loading: boolean;
  refresh: () => void;
}

export function useDetection(): UseDetectionResult {
  const [report, setReport] = useState<DetectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);

  const runDetection = useCallback(async () => {
    if (runningRef.current) return;
    const now = Date.now();
    if (now - lastRunRef.current < THROTTLE_MS && lastRunRef.current > 0) return;

    runningRef.current = true;
    setLoading(true);
    try {
      const result = await detectAll();
      setReport(result);
      lastRunRef.current = Date.now();
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    runDetection();
  }, [runDetection]);

  return { report, loading, refresh: runDetection };
}

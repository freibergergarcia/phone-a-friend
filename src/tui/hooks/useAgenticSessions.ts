/**
 * Hook for loading agentic sessions from the SQLite transcript bus.
 * Read-only — opens a separate DB connection for the TUI.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TranscriptBus } from '../../agentic/bus.js';
import type { AgenticSession, Message } from '../../agentic/types.js';

export interface UseAgenticSessionsResult {
  sessions: AgenticSession[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  getTranscript: (sessionId: string) => Message[];
  deleteSession: (sessionId: string) => void;
}

export function useAgenticSessions(): UseAgenticSessionsResult {
  const [sessions, setSessions] = useState<AgenticSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const busRef = useRef<TranscriptBus | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      busRef.current?.close();
    };
  }, []);

  const getBus = useCallback((): TranscriptBus => {
    if (!busRef.current) {
      busRef.current = new TranscriptBus();
    }
    return busRef.current;
  }, []);

  const load = useCallback(() => {
    try {
      const bus = getBus();
      const list = bus.listSessions();
      if (mountedRef.current) {
        setSessions(list);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [getBus]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getTranscript = useCallback((sessionId: string): Message[] => {
    try {
      return getBus().getTranscript(sessionId);
    } catch {
      return [];
    }
  }, [getBus]);

  const deleteSession = useCallback((sessionId: string) => {
    try {
      getBus().deleteSession(sessionId);
      load(); // Refresh list
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [getBus, load]);

  return { sessions, loading, error, refresh: load, getTranscript, deleteSession };
}

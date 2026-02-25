/**
 * Agentic panel — session browser with transcript viewer.
 *
 * Two-pane layout: session list (left) and transcript detail (right).
 * Navigated with arrow keys; Enter drills into transcript, Esc goes back.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Badge } from './components/Badge.js';
import type { BadgeStatus } from './components/Badge.js';
import type { UseAgenticSessionsResult } from './hooks/useAgenticSessions.js';
import type { AgenticSession, Message } from '../agentic/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionBadge(status: string): BadgeStatus {
  if (status === 'completed') return 'available';
  if (status === 'active') return 'partial';
  if (status === 'failed') return 'unavailable';
  return 'planned'; // stopped
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '\u2026';
}

// ---------------------------------------------------------------------------
// Session list view
// ---------------------------------------------------------------------------

interface SessionListProps {
  sessions: AgenticSession[];
  selectedIndex: number;
}

function SessionList({ sessions, selectedIndex }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold underline>Agentic Sessions</Text>
        <Text dimColor>No sessions yet. Run one with:</Text>
        <Text color="cyan">  phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "..."</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold underline>Agentic Sessions ({sessions.length})</Text>
      <Text dimColor> </Text>
      {sessions.map((s, i) => {
        const selected = i === selectedIndex;
        const agentNames = s.agents.map((a) => a.name).join(', ');
        return (
          <Box key={s.id} gap={1}>
            <Text>{selected ? '\u25b8' : ' '}</Text>
            <Badge status={sessionBadge(s.status)} />
            <Text bold={selected} color={selected ? 'cyan' : undefined}>
              {s.id}
            </Text>
            <Text dimColor>{formatDate(s.createdAt)} {formatTime(s.createdAt)}</Text>
            <Text dimColor>|</Text>
            <Text dimColor>{agentNames || 'no agents'}</Text>
            <Text dimColor>|</Text>
            <Text dimColor>{truncate(s.prompt, 40)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Session detail / transcript view
// ---------------------------------------------------------------------------

interface SessionDetailProps {
  session: AgenticSession;
  transcript: Message[];
  scrollOffset: number;
}

function SessionDetail({ session, transcript, scrollOffset }: SessionDetailProps) {
  const agentList = session.agents.map((a) => `${a.name}(${a.backend})`).join(', ');
  const visibleLines = 15;
  const visible = transcript.slice(scrollOffset, scrollOffset + visibleLines);
  const hasMore = scrollOffset + visibleLines < transcript.length;
  const hasLess = scrollOffset > 0;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={1}>
          <Badge status={sessionBadge(session.status)} />
          <Text bold>Session {session.id}</Text>
          <Text dimColor>{session.status}</Text>
          <Text dimColor>| Turn {session.turn}</Text>
          {session.endedAt && (
            <Text dimColor>| {formatDate(session.createdAt)} {formatTime(session.createdAt)} - {formatTime(session.endedAt)}</Text>
          )}
        </Box>
        <Text dimColor>  Agents: {agentList}</Text>
        <Text dimColor>  Prompt: {truncate(session.prompt, 70)}</Text>
      </Box>

      {/* Transcript */}
      <Text bold underline>Transcript ({transcript.length} messages)</Text>
      {hasLess && <Text dimColor>  {'\u25b2'} {scrollOffset} more above</Text>}
      {visible.map((msg) => (
        <Box key={msg.id} gap={1} paddingLeft={1}>
          <Text dimColor>[T{msg.turn}]</Text>
          <Text color="cyan" bold>{msg.from}</Text>
          <Text dimColor>{'\u2192'}</Text>
          <Text color="yellow">{msg.to}</Text>
          <Text>{truncate(msg.content.replace(/\n/g, ' '), 60)}</Text>
        </Box>
      ))}
      {hasMore && <Text dimColor>  {'\u25bc'} {transcript.length - scrollOffset - visibleLines} more below</Text>}

      {transcript.length === 0 && <Text dimColor>  No messages recorded</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export interface AgenticPanelProps {
  agenticSessions: UseAgenticSessionsResult;
}

export function AgenticPanel({ agenticSessions }: AgenticPanelProps) {
  const { sessions, loading, error, refresh, getTranscript, deleteSession } = agenticSessions;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewingSession, setViewingSession] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const activeSession = useMemo(
    () => viewingSession ? sessions.find((s) => s.id === viewingSession) ?? null : null,
    [sessions, viewingSession],
  );

  const transcript = useMemo(
    () => viewingSession ? getTranscript(viewingSession) : [],
    [viewingSession, getTranscript],
  );

  useInput((input, key) => {
    // Delete confirmation
    if (confirming) {
      if (input === 'y' || input === 'Y') {
        const session = sessions[selectedIndex];
        if (session) {
          deleteSession(session.id);
          setConfirming(false);
          if (selectedIndex >= sessions.length - 1) {
            setSelectedIndex(Math.max(0, sessions.length - 2));
          }
        }
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setConfirming(false);
      }
      return;
    }

    // Transcript view
    if (viewingSession) {
      if (key.escape || input === 'h') {
        setViewingSession(null);
        setScrollOffset(0);
        return;
      }
      if (key.downArrow) {
        setScrollOffset((o) => Math.min(o + 1, Math.max(0, transcript.length - 15)));
      }
      if (key.upArrow) {
        setScrollOffset((o) => Math.max(o - 1, 0));
      }
      return;
    }

    // Session list
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(i + 1, sessions.length - 1));
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (key.return || input === 'l') {
      const session = sessions[selectedIndex];
      if (session) {
        setViewingSession(session.id);
        setScrollOffset(0);
      }
    }
    if (input === 'd') {
      if (sessions[selectedIndex]) {
        setConfirming(true);
      }
    }
  });

  if (loading) {
    return <Text color="cyan">Loading sessions...</Text>;
  }

  if (error) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold underline>Agentic Sessions</Text>
        <Text color="red">Error: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      {viewingSession && activeSession ? (
        <SessionDetail
          session={activeSession}
          transcript={transcript}
          scrollOffset={scrollOffset}
        />
      ) : (
        <SessionList sessions={sessions} selectedIndex={selectedIndex} />
      )}

      {confirming && (
        <Text color="yellow">Delete session {sessions[selectedIndex]?.id}? (y/n)</Text>
      )}

      {/* Contextual hints */}
      <Box>
        {viewingSession ? (
          <Text dimColor>Esc/h back  {'\u2191\u2193'} scroll  r refresh</Text>
        ) : (
          <Text dimColor>Enter/l view  d delete  r refresh  {'\u2191\u2193'} navigate</Text>
        )}
      </Box>
    </Box>
  );
}

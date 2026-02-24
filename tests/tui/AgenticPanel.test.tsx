/**
 * Tests for AgenticPanel — session browser + transcript viewer.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// Mock better-sqlite3 to avoid native addon in tests
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import { AgenticPanel } from '../../src/tui/AgenticPanel.js';
import type { UseAgenticSessionsResult } from '../../src/tui/hooks/useAgenticSessions.js';
import type { AgenticSession, Message } from '../../src/agentic/types.js';

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function makeMockSessions(count: number): AgenticSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `sess-${i + 1}`,
    createdAt: new Date('2026-02-24T14:00:00Z'),
    endedAt: i === 0 ? new Date('2026-02-24T14:01:00Z') : undefined,
    prompt: `Test prompt ${i + 1}`,
    status: i === 0 ? 'completed' as const : 'active' as const,
    agents: [
      { name: 'reviewer', backend: 'claude', status: 'idle' as const, messageCount: 2 },
      { name: 'critic', backend: 'claude', status: 'idle' as const, messageCount: 1 },
    ],
    turn: 2,
    maxTurns: 20,
  }));
}

const MOCK_TRANSCRIPT: Message[] = [
  { id: 1, sessionId: 'sess-1', from: 'user', to: 'reviewer', content: 'Hello world', timestamp: new Date(), turn: 0 },
  { id: 2, sessionId: 'sess-1', from: 'reviewer', to: 'user', content: 'Hi back!', timestamp: new Date(), turn: 0 },
  { id: 3, sessionId: 'sess-1', from: 'reviewer', to: 'critic', content: 'What do you think?', timestamp: new Date(), turn: 1 },
];

function makeMockResult(overrides?: Partial<UseAgenticSessionsResult>): UseAgenticSessionsResult {
  return {
    sessions: makeMockSessions(3),
    loading: false,
    error: null,
    refresh: vi.fn(),
    getTranscript: vi.fn().mockReturnValue(MOCK_TRANSCRIPT),
    deleteSession: vi.fn(),
    ...overrides,
  };
}

describe('AgenticPanel', () => {
  it('shows empty state when no sessions', () => {
    const result = makeMockResult({ sessions: [] });
    const { lastFrame } = render(<AgenticPanel agenticSessions={result} />);
    const frame = lastFrame();
    expect(frame).toContain('No sessions yet');
    expect(frame).toContain('agentic run');
  });

  it('shows loading state', () => {
    const result = makeMockResult({ loading: true, sessions: [] });
    const { lastFrame } = render(<AgenticPanel agenticSessions={result} />);
    expect(lastFrame()).toContain('Loading sessions');
  });

  it('shows error state', () => {
    const result = makeMockResult({ error: new Error('DB locked'), sessions: [] });
    const { lastFrame } = render(<AgenticPanel agenticSessions={result} />);
    expect(lastFrame()).toContain('DB locked');
  });

  it('shows session list with count', () => {
    const result = makeMockResult();
    const { lastFrame } = render(<AgenticPanel agenticSessions={result} />);
    const frame = lastFrame();
    expect(frame).toContain('Agentic Sessions (3)');
    expect(frame).toContain('sess-1');
    expect(frame).toContain('sess-2');
    expect(frame).toContain('sess-3');
  });

  it('shows agent names in session list', () => {
    const result = makeMockResult();
    const { lastFrame } = render(<AgenticPanel agenticSessions={result} />);
    expect(lastFrame()).toContain('reviewer, critic');
  });

  it('navigates with arrow keys', async () => {
    const result = makeMockResult();
    const { lastFrame, stdin } = render(<AgenticPanel agenticSessions={result} />);

    // First item selected by default (has pointer)
    let frame = lastFrame();
    // Contains the sessions
    expect(frame).toContain('sess-1');

    // Move down
    stdin.write('\u001B[B'); // down arrow
    await tick();

    // Verify we can still see the list
    frame = lastFrame();
    expect(frame).toContain('sess-2');
  });

  it('drills into transcript on Enter', async () => {
    const result = makeMockResult();
    const { lastFrame, stdin } = render(<AgenticPanel agenticSessions={result} />);

    stdin.write('\r'); // Enter
    await tick();

    const frame = lastFrame();
    expect(frame).toContain('Session sess-1');
    expect(frame).toContain('Transcript');
    expect(result.getTranscript).toHaveBeenCalledWith('sess-1');
  });

  it('shows transcript messages in detail view', async () => {
    const result = makeMockResult();
    const { lastFrame, stdin } = render(<AgenticPanel agenticSessions={result} />);

    stdin.write('\r'); // Enter
    await tick();

    const frame = lastFrame();
    expect(frame).toContain('user');
    expect(frame).toContain('reviewer');
    expect(frame).toContain('Hello world');
  });

  it('goes back from detail with Escape', async () => {
    const result = makeMockResult();
    const { lastFrame, stdin } = render(<AgenticPanel agenticSessions={result} />);

    stdin.write('\r'); // Enter into detail
    await tick();
    expect(lastFrame()).toContain('Session sess-1');

    stdin.write('\u001B'); // Escape
    await tick();
    expect(lastFrame()).toContain('Agentic Sessions (3)');
  });

  it('shows contextual key hints for list view', () => {
    const result = makeMockResult();
    const { lastFrame } = render(<AgenticPanel agenticSessions={result} />);
    expect(lastFrame()).toContain('Enter');
    expect(lastFrame()).toContain('delete');
  });

  it('shows contextual key hints for detail view', async () => {
    const result = makeMockResult();
    const { lastFrame, stdin } = render(<AgenticPanel agenticSessions={result} />);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('Esc');
    expect(lastFrame()).toContain('scroll');
  });

  it('shows delete confirmation', async () => {
    const result = makeMockResult();
    const { lastFrame, stdin } = render(<AgenticPanel agenticSessions={result} />);

    stdin.write('d');
    await tick();
    expect(lastFrame()).toContain('Delete session');
    expect(lastFrame()).toContain('y/n');
  });

  it('deletes session on confirmation', async () => {
    const result = makeMockResult();
    const { stdin } = render(<AgenticPanel agenticSessions={result} />);

    stdin.write('d');
    await tick();
    stdin.write('y');
    await tick();

    expect(result.deleteSession).toHaveBeenCalledWith('sess-1');
  });

  it('cancels delete on n', async () => {
    const result = makeMockResult();
    const { lastFrame, stdin } = render(<AgenticPanel agenticSessions={result} />);

    stdin.write('d');
    await tick();
    stdin.write('n');
    await tick();

    expect(result.deleteSession).not.toHaveBeenCalled();
    expect(lastFrame()).not.toContain('Delete session');
  });
});

import { describe, it, expect } from 'vitest';
import { assignAgentNames } from '../../src/agentic/names.js';
import type { AgentConfig } from '../../src/agentic/types.js';

describe('assignAgentNames', () => {
  it('assigns firstname.role format to plain role names', () => {
    const agents: AgentConfig[] = [
      { name: 'storyteller', backend: 'claude' },
      { name: 'poet', backend: 'claude' },
    ];

    const result = assignAgentNames(agents);

    expect(result).toHaveLength(2);
    for (const agent of result) {
      expect(agent.name).toMatch(/^[a-z][\w-]+\.\w+$/);
      expect(agent.name).toContain('.');
    }
    // Roles preserved after the dot
    expect(result[0].name).toMatch(/\.storyteller$/);
    expect(result[1].name).toMatch(/\.poet$/);
  });

  it('does not modify names that already contain a dot', () => {
    const agents: AgentConfig[] = [
      { name: 'maren.storyteller', backend: 'claude' },
      { name: 'poet', backend: 'claude' },
    ];

    const result = assignAgentNames(agents);

    expect(result[0].name).toBe('maren.storyteller');
    expect(result[1].name).toMatch(/^\w+\.poet$/);
    // Should not reuse 'maren'
    expect(result[1].name).not.toMatch(/^maren\./);
  });

  it('assigns unique first names across agents', () => {
    const agents: AgentConfig[] = [
      { name: 'security', backend: 'claude' },
      { name: 'perf', backend: 'claude' },
      { name: 'quality', backend: 'codex' },
      { name: 'reviewer', backend: 'gemini' },
      { name: 'architect', backend: 'claude' },
    ];

    const result = assignAgentNames(agents);
    const firstNames = result.map((a) => a.name.split('.')[0]);

    // All unique
    expect(new Set(firstNames).size).toBe(firstNames.length);
  });

  it('preserves other agent config fields', () => {
    const agents: AgentConfig[] = [
      { name: 'reviewer', backend: 'claude', model: 'opus', description: 'Code reviewer' },
    ];

    const result = assignAgentNames(agents);

    expect(result[0].backend).toBe('claude');
    expect(result[0].model).toBe('opus');
    expect(result[0].description).toBe('Code reviewer');
    expect(result[0].name).toMatch(/\.reviewer$/);
  });

  it('does not mutate the input array', () => {
    const agents: AgentConfig[] = [
      { name: 'storyteller', backend: 'claude' },
    ];

    const result = assignAgentNames(agents);

    expect(agents[0].name).toBe('storyteller');
    expect(result[0].name).not.toBe('storyteller');
  });

  it('handles empty agent list', () => {
    expect(assignAgentNames([])).toEqual([]);
  });

  it('handles many agents without collision', () => {
    const agents: AgentConfig[] = Array.from({ length: 30 }, (_, i) => ({
      name: `role${i}`,
      backend: 'claude',
    }));

    const result = assignAgentNames(agents);
    const firstNames = result.map((a) => a.name.split('.')[0]);

    expect(new Set(firstNames).size).toBe(30);
  });

  it('falls back gracefully when pool is exhausted', () => {
    // Create more agents than the pool size (50)
    const agents: AgentConfig[] = Array.from({ length: 55 }, (_, i) => ({
      name: `role${i}`,
      backend: 'claude',
    }));

    const result = assignAgentNames(agents);
    const firstNames = result.map((a) => a.name.split('.')[0]);

    // All unique despite exceeding pool
    expect(new Set(firstNames).size).toBe(55);
    // Overflow agents get agent-N prefix
    const overflowNames = firstNames.filter((n) => n.startsWith('agent-'));
    expect(overflowNames.length).toBeGreaterThan(0);
  });
});

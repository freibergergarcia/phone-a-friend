/**
 * Creative name generator for agentic sessions.
 *
 * Auto-assigns memorable human first names to agents, producing
 * compound identities like `maren.storyteller` or `einar.poet`.
 * If a name already contains a dot, it's treated as user-provided
 * and left untouched.
 */

import type { AgentConfig } from './types.js';

// ---------------------------------------------------------------------------
// Name pool — short, diverse, memorable, easy to type in @mentions
// ---------------------------------------------------------------------------

const NAME_POOL = [
  'ada', 'akira', 'alba', 'arlo', 'asha',
  'basil', 'bryn', 'cleo', 'cyrus', 'dara',
  'eiko', 'einar', 'elara', 'ezra', 'fern',
  'gael', 'hana', 'ines', 'idris', 'juno',
  'kai', 'kira', 'lars', 'lena', 'lux',
  'maren', 'milo', 'nadia', 'nico', 'nova',
  'orin', 'petra', 'quinn', 'ravi', 'rune',
  'sage', 'soren', 'tala', 'thea', 'teo',
  'uri', 'vera', 'wren', 'xander', 'yara',
  'zara', 'zeke', 'io', 'leif', 'sol',
] as const;

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Assign creative first names to agents that don't already have one.
 *
 * Rules:
 * - If `agent.name` contains a dot, it's already named — skip it
 * - Otherwise, prefix a random unique first name: `name.role`
 * - Names are drawn without replacement so agents in the same session
 *   never share a first name
 * - If the pool is exhausted (>50 agents), falls back to `agent-N.role`
 *
 * Returns a **new array** — does not mutate the input.
 */
export function assignAgentNames(agents: AgentConfig[]): AgentConfig[] {
  // Shuffle a copy of the pool
  const available = shuffle([...NAME_POOL]);

  // Track used names to avoid collisions with user-provided ones
  const used = new Set<string>();
  for (const a of agents) {
    if (a.name.includes('.')) {
      used.add(a.name.split('.')[0]);
    }
  }

  return agents.map((agent) => {
    // Already has a dot-name — user provided
    if (agent.name.includes('.')) return { ...agent };

    // Pick an unused name from the pool
    let firstName: string | undefined;
    while (available.length > 0) {
      const candidate = available.pop()!;
      if (!used.has(candidate)) {
        firstName = candidate;
        used.add(candidate);
        break;
      }
    }

    // Fallback if pool exhausted
    if (!firstName) {
      firstName = `agent-${used.size}`;
      used.add(firstName);
    }

    return { ...agent, name: `${firstName}.${agent.name}` };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates shuffle (in-place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

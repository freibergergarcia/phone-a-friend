/**
 * Message parser for agentic mode.
 *
 * Extracts @agent: mentions from agent responses. Rules:
 * 1. Skip fenced code blocks (``` ... ```)
 * 2. Skip blockquotes (lines starting with >)
 * 3. Match @name: at line start only
 * 4. Validate against known agent names
 * 5. Unmatched lines are working notes (logged but not routed)
 */

export interface ParsedMessage {
  to: string;
  content: string;
}

export interface ParseResult {
  /** Messages to route to other agents */
  messages: ParsedMessage[];
  /** Working notes (not routed) */
  notes: string;
}

/**
 * Parse an agent's response text into routable messages and working notes.
 *
 * @param text - Raw response from the agent
 * @param knownAgents - Set of valid agent names (including "all" and "user")
 * @returns Parsed messages and working notes
 */
export function parseAgentResponse(
  text: string,
  knownAgents: Set<string>,
): ParseResult {
  const lines = text.split('\n');
  const messages: ParsedMessage[] = [];
  const noteLines: string[] = [];

  let inCodeBlock = false;
  let currentMessage: ParsedMessage | null = null;

  for (const line of lines) {
    // Track fenced code blocks
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      // Code fence lines are always notes
      if (currentMessage) {
        messages.push(currentMessage);
        currentMessage = null;
      }
      noteLines.push(line);
      continue;
    }

    // Inside code block — everything is notes
    if (inCodeBlock) {
      if (currentMessage) {
        messages.push(currentMessage);
        currentMessage = null;
      }
      noteLines.push(line);
      continue;
    }

    // Skip blockquotes
    if (line.trimStart().startsWith('>')) {
      if (currentMessage) {
        messages.push(currentMessage);
        currentMessage = null;
      }
      noteLines.push(line);
      continue;
    }

    // Try to match @agent: at line start
    const match = line.match(/^@(\w+):\s*(.*)/);
    if (match) {
      const [, target, content] = match;

      // Validate agent name
      if (knownAgents.has(target)) {
        // Save previous message if any
        if (currentMessage) {
          messages.push(currentMessage);
        }
        currentMessage = { to: target, content: content.trim() };
        continue;
      }
    }

    // Continuation of a multi-line message (indented or non-empty after @mention)
    if (currentMessage && line.trim().length > 0) {
      currentMessage.content += '\n' + line;
      continue;
    }

    // Empty line after a message — finalize it
    if (currentMessage && line.trim().length === 0) {
      messages.push(currentMessage);
      currentMessage = null;
      noteLines.push(line);
      continue;
    }

    // Everything else is notes
    noteLines.push(line);
  }

  // Finalize any trailing message
  if (currentMessage) {
    messages.push(currentMessage);
  }

  return {
    messages,
    notes: noteLines.join('\n').trim(),
  };
}

/**
 * Build the system prompt for an agent in an agentic session.
 */
export function buildSystemPrompt(
  role: string,
  agents: string[],
  description?: string,
): string {
  const otherAgents = agents.filter((a) => a !== role);
  const roleDesc = description
    ? `Your role: ${description}`
    : `Stay focused on your role: ${role}`;

  return [
    `You are the "${role}" agent in a multi-agent review session.`,
    `Other agents: ${otherAgents.join(', ')}`,
    '',
    'To message another agent, start a NEW LINE with @name: followed by your message.',
    'Examples:',
    `  @${otherAgents[0] ?? 'other'}: Is this a concern from your perspective?`,
    '  @all: Here is my summary of findings.',
    '  @user: Final report ready.',
    '',
    'Rules:',
    '- One @mention per line. Each line starting with @name: is a separate message.',
    '- Lines without @name: are your private working notes (not sent to anyone).',
    `- ${roleDesc}`,
    '- Be specific. Cite file paths and line numbers when reviewing code.',
  ].join('\n');
}

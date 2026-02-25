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
    const match = line.match(/^@([\w.-]+):\s*(.*)/);
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
  // Extract the role part (after the dot) for the description fallback
  const rolePart = role.includes('.') ? role.split('.').slice(1).join('.') : role;
  const roleDesc = description
    ? `Your role: ${description}`
    : `Stay focused on your role: ${rolePart}`;

  return [
    `You are "${role}" in a multi-agent session.`,
    `Other agents: ${otherAgents.join(', ')}`,
    '',
    'Agent names use the format firstname.role (e.g. maren.storyteller).',
    'Always use the FULL name (including the dot) in @mentions.',
    '',
    'HOW COMMUNICATION WORKS:',
    '- Plain text (no @mention) = your working notes. Visible in the transcript',
    '  but does NOT trigger a response from anyone. Use this for thinking,',
    '  commentary, or output that doesn\'t need a reply.',
    '- @name: message = sends a message to that agent and TRIGGERS THEM TO RESPOND.',
    '  Only use @mentions when you specifically need that agent to act or reply.',
    '- @user: message = final output delivered to the human. Use when the task is done.',
    '- @all: message = broadcast to every agent (triggers ALL of them to respond).',
    '',
    'CRITICAL: Do NOT @mention an agent unless you need them to do something.',
    'Unnecessary @mentions create infinite conversation loops. If you\'re done',
    'or just want to comment, write plain text instead.',
    '',
    'To message another agent, start a NEW LINE with @name: followed by your message.',
    'Your full message content goes after the @name: on the same line and continues',
    'on subsequent lines until the next @mention or blank line.',
    '',
    'Examples:',
    'I\'ve analyzed the problem and found the key issue is X.',
    '',
    `@${otherAgents[0] ?? 'other'}: Based on my analysis, I need you to verify X.`,
    'Here are the details you\'ll need to check.',
    '',
    '@user: Final report ready.',
    '',
    'Rules:',
    '- @mention = request for action. Plain text = notes/commentary.',
    '- Each line starting with @name: begins a new message to that agent.',
    '- Multi-line messages: lines after @name: continue until the next @mention or blank line.',
    `- ${roleDesc}`,
    '- When asked to start or go first, produce your output directly — do not ask others to start.',
    '- When your work is complete and you have nothing to request, write plain text. Do NOT',
    '  @mention agents just to say goodbye, acknowledge, or agree — that wastes their turn.',
  ].join('\n');
}

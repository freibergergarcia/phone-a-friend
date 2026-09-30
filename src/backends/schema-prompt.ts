/**
 * Prompt-injected structured output for backends with no native schema flag
 * (Gemini, OpenCode, pi). Best-effort: the model is asked for JSON matching
 * the schema, and nothing here validates the reply.
 */
export function injectSchemaPrompt(prompt: string, schema: string): string {
  return `${prompt}\n\nRespond with JSON only. The response must match this JSON Schema exactly:\n${schema}`;
}

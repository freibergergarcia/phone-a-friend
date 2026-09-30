import { describe, expect, it } from 'vitest';
import { injectSchemaPrompt } from '../../src/backends/schema-prompt.js';

describe('injectSchemaPrompt()', () => {
  it('appends the JSON-only instruction and the schema, byte for byte', () => {
    // Gemini and OpenCode each carried this exact template before it was
    // shared; their own tests assert on the resulting prompts unchanged.
    expect(injectSchemaPrompt('Return ok.', '{"type":"object"}')).toBe(
      'Return ok.\n\nRespond with JSON only. The response must match this JSON Schema exactly:\n{"type":"object"}',
    );
  });

  it('leaves the prompt and schema text untouched', () => {
    const prompt = '  leading and trailing space  ';
    const schema = '{\n  "type": "string"\n}';
    const out = injectSchemaPrompt(prompt, schema);
    expect(out.startsWith(prompt)).toBe(true);
    expect(out.endsWith(schema)).toBe(true);
  });
});

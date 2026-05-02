import { describe, it, expect } from 'vitest';
import {
  buildVerdictPrompt,
  DEFAULT_REVIEW_REQUEST,
  deriveVerdict,
  parseVerdict,
  serializeVerdict,
  VERDICT_INSTRUCTIONS,
  VERDICT_SCHEMA,
  VERDICT_SCHEMA_VERSION,
  VERDICT_SYSTEM_PROMPT,
  VerdictParseError,
  type VerdictEnvelope,
} from '../src/verdict.js';

const SHIP_PAYLOAD = JSON.stringify({
  schema_version: 1,
  verdict: 'ship',
  summary: 'Looks good.',
  findings: [],
});

const ITERATE_PAYLOAD = JSON.stringify({
  schema_version: 1,
  verdict: 'iterate',
  summary: 'Has a blocker.',
  findings: [
    {
      severity: 'blocker',
      title: 'Missing input validation',
      rationale: 'Untrusted data flows into the SQL query without escaping.',
      location: 'src/db.ts:42',
    },
  ],
});

describe('VERDICT_SCHEMA constant', () => {
  it('declares schema_version 1 and additionalProperties: false', () => {
    expect(VERDICT_SCHEMA_VERSION).toBe(1);
    expect((VERDICT_SCHEMA as Record<string, unknown>).additionalProperties).toBe(false);
  });
});

describe('VERDICT_INSTRUCTIONS', () => {
  it('mentions the canonical envelope keys and severity levels', () => {
    expect(VERDICT_INSTRUCTIONS).toMatch(/schema_version/);
    expect(VERDICT_INSTRUCTIONS).toMatch(/blocker/);
    expect(VERDICT_INSTRUCTIONS).toMatch(/important/);
    expect(VERDICT_INSTRUCTIONS).toMatch(/nit/);
    expect(VERDICT_INSTRUCTIONS).toMatch(/ship/);
    expect(VERDICT_INSTRUCTIONS).toMatch(/iterate/);
    expect(VERDICT_INSTRUCTIONS).toMatch(/abstain/);
  });
});

describe('buildVerdictPrompt', () => {
  it('uses the caller request when provided', () => {
    const out = buildVerdictPrompt('focus on the auth module');
    expect(out).toMatch(/Review request:/);
    expect(out).toMatch(/focus on the auth module/);
    expect(out).toMatch(/JSON object/);
  });

  it('falls back to the default request when caller passes null', () => {
    const out = buildVerdictPrompt(null);
    expect(out).toContain(DEFAULT_REVIEW_REQUEST);
  });

  it('falls back to the default request when caller passes empty string', () => {
    const out = buildVerdictPrompt('   ');
    expect(out).toContain(DEFAULT_REVIEW_REQUEST);
  });

  it('VERDICT_SYSTEM_PROMPT matches buildVerdictPrompt(null)', () => {
    expect(VERDICT_SYSTEM_PROMPT).toBe(buildVerdictPrompt(null));
  });
});

describe('parseVerdict', () => {
  it('parses a clean ship payload', () => {
    const env = parseVerdict(SHIP_PAYLOAD);
    expect(env.verdict).toBe('ship');
    expect(env.findings).toEqual([]);
    expect(env.schema_version).toBe(1);
  });

  it('parses a clean iterate payload', () => {
    const env = parseVerdict(ITERATE_PAYLOAD);
    expect(env.verdict).toBe('iterate');
    expect(env.findings).toHaveLength(1);
    expect(env.findings[0].severity).toBe('blocker');
    expect(env.findings[0].location).toBe('src/db.ts:42');
  });

  it('parses an abstain payload with empty findings', () => {
    const env = parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'abstain',
      summary: 'I cannot evaluate without seeing the migration plan.',
      findings: [],
    }));
    expect(env.verdict).toBe('abstain');
  });

  it('strips ```json fence and parses', () => {
    const fenced = '```json\n' + SHIP_PAYLOAD + '\n```';
    const env = parseVerdict(fenced);
    expect(env.verdict).toBe('ship');
  });

  it('strips bare ``` fence and parses', () => {
    const fenced = '```\n' + SHIP_PAYLOAD + '\n```';
    const env = parseVerdict(fenced);
    expect(env.verdict).toBe('ship');
  });

  it('overrides ship when a blocker is present (model lied)', () => {
    const malformed = JSON.stringify({
      schema_version: 1,
      verdict: 'ship',
      summary: 'lgtm',
      findings: [
        { severity: 'blocker', title: 'sql injection', rationale: 'unsafe.', location: null },
      ],
    });
    expect(() => parseVerdict(malformed)).toThrow(VerdictParseError);
    expect(() => parseVerdict(malformed)).toThrow(/contradicts findings/);
  });

  it('overrides iterate when only nits are present', () => {
    const malformed = JSON.stringify({
      schema_version: 1,
      verdict: 'iterate',
      summary: 'eh',
      findings: [
        { severity: 'nit', title: 'rename var', rationale: 'minor.', location: null },
      ],
    });
    expect(() => parseVerdict(malformed)).toThrow(VerdictParseError);
  });

  it('rejects abstain with non-empty findings', () => {
    const malformed = JSON.stringify({
      schema_version: 1,
      verdict: 'abstain',
      summary: 'mixed',
      findings: [
        { severity: 'nit', title: 'whitespace', rationale: 'minor.', location: null },
      ],
    });
    expect(() => parseVerdict(malformed)).toThrow(VerdictParseError);
  });

  it('treats only-nit findings as ship', () => {
    const env = parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'ship',
      summary: 'minor stuff',
      findings: [
        { severity: 'nit', title: 'whitespace', rationale: 'minor.', location: null },
        { severity: 'nit', title: 'comment', rationale: 'minor.', location: 'src/x.ts' },
      ],
    }));
    expect(env.verdict).toBe('ship');
    expect(env.findings).toHaveLength(2);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseVerdict('not json')).toThrow(VerdictParseError);
    expect(() => parseVerdict('not json')).toThrow(/not valid JSON/);
  });

  it('rejects array at root', () => {
    expect(() => parseVerdict('[]')).toThrow(VerdictParseError);
  });

  it('rejects schema_version mismatch', () => {
    expect(() => parseVerdict(JSON.stringify({
      schema_version: 99,
      verdict: 'ship',
      summary: 'x',
      findings: [],
    }))).toThrow(/schema_version mismatch/);
  });

  it('rejects empty summary', () => {
    expect(() => parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'ship',
      summary: '',
      findings: [],
    }))).toThrow(/summary must be a non-empty string/);
  });

  it('rejects findings as non-array', () => {
    expect(() => parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'ship',
      summary: 'x',
      findings: 'oops',
    }))).toThrow(/findings must be an array/);
  });

  it('rejects unknown severity', () => {
    expect(() => parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'iterate',
      summary: 'x',
      findings: [{ severity: 'critical', title: 't', rationale: 'r', location: null }],
    }))).toThrow(/severity must be one of/);
  });

  it('rejects empty title', () => {
    expect(() => parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'iterate',
      summary: 'x',
      findings: [{ severity: 'blocker', title: '', rationale: 'r', location: null }],
    }))).toThrow(/title must be a non-empty string/);
  });

  it('rejects unknown verdict', () => {
    expect(() => parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'looks-good',
      summary: 'x',
      findings: [],
    }))).toThrow(/verdict must be one of/);
  });

  it('attaches raw to VerdictParseError', () => {
    const raw = 'totally not json';
    try {
      parseVerdict(raw);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VerdictParseError);
      expect((err as VerdictParseError).raw).toBe(raw);
    }
  });

  it('accepts location: null explicitly', () => {
    const env = parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'iterate',
      summary: 'x',
      findings: [
        { severity: 'important', title: 't', rationale: 'r', location: null },
      ],
    }));
    expect(env.findings[0].location).toBeNull();
  });

  it('accepts location omitted (treats as null)', () => {
    const env = parseVerdict(JSON.stringify({
      schema_version: 1,
      verdict: 'iterate',
      summary: 'x',
      findings: [
        { severity: 'important', title: 't', rationale: 'r' },
      ],
    }));
    expect(env.findings[0].location).toBeNull();
  });
});

describe('deriveVerdict', () => {
  it('returns iterate for any blocker', () => {
    expect(deriveVerdict([
      { severity: 'blocker', title: 't', rationale: 'r', location: null },
    ], 'iterate')).toBe('iterate');
  });

  it('returns iterate for any important', () => {
    expect(deriveVerdict([
      { severity: 'important', title: 't', rationale: 'r', location: null },
    ], 'iterate')).toBe('iterate');
  });

  it('returns null when claim says ship despite blocker', () => {
    expect(deriveVerdict([
      { severity: 'blocker', title: 't', rationale: 'r', location: null },
    ], 'ship')).toBeNull();
  });

  it('returns null when claim says abstain despite blocker', () => {
    expect(deriveVerdict([
      { severity: 'blocker', title: 't', rationale: 'r', location: null },
    ], 'abstain')).toBeNull();
  });

  it('returns ship for empty findings', () => {
    expect(deriveVerdict([], 'ship')).toBe('ship');
  });

  it('returns ship for only nits', () => {
    expect(deriveVerdict([
      { severity: 'nit', title: 't', rationale: 'r', location: null },
    ], 'ship')).toBe('ship');
  });

  it('returns abstain for explicit abstain with empty findings', () => {
    expect(deriveVerdict([], 'abstain')).toBe('abstain');
  });

  it('returns null for abstain with any finding', () => {
    expect(deriveVerdict([
      { severity: 'nit', title: 't', rationale: 'r', location: null },
    ], 'abstain')).toBeNull();
  });

  it('returns null when claim says iterate but only nits', () => {
    expect(deriveVerdict([
      { severity: 'nit', title: 't', rationale: 'r', location: null },
    ], 'iterate')).toBeNull();
  });
});

describe('serializeVerdict', () => {
  it('emits compact one-line JSON', () => {
    const env: VerdictEnvelope = {
      schema_version: 1,
      verdict: 'ship',
      summary: 'ok',
      findings: [],
    };
    const out = serializeVerdict(env);
    expect(out).not.toContain('\n');
    expect(JSON.parse(out)).toEqual(env);
  });
});

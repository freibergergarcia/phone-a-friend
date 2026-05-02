/**
 * Verdict envelope for review mode (--verdict-json).
 *
 * Provides an opinionated machine-readable structure so callers (especially
 * /phone-a-team and downstream skills) can decide iterate-or-stop without
 * regexing free-text reviews. The envelope is the same shape across every
 * backend; the verdict field is derived from severities at parse time so
 * orchestrators do not have to trust the model's self-summary.
 *
 * Decision rule (enforced in parseVerdict):
 *   - any 'blocker' or 'important' finding -> 'iterate'
 *   - empty findings, or only 'nit' findings -> 'ship'
 *   - 'abstain' is allowed only when findings is empty (the reviewer cannot
 *     make a confident call)
 *
 * Contradictions ("verdict": "ship" with a blocker finding) are treated as
 * malformed model output; parseVerdict throws VerdictParseError. Callers
 * fail closed: no stdout payload, raw response goes to stderr, non-zero
 * exit. No regex rescue.
 */

export const VERDICT_SCHEMA_VERSION = 1;

export type VerdictKind = 'ship' | 'iterate' | 'abstain';
export type FindingSeverity = 'blocker' | 'important' | 'nit';

export interface Finding {
  severity: FindingSeverity;
  title: string;
  rationale: string;
  location: string | null;
}

export interface VerdictEnvelope {
  schema_version: typeof VERDICT_SCHEMA_VERSION;
  verdict: VerdictKind;
  summary: string;
  findings: Finding[];
}

/**
 * JSON Schema for the verdict envelope. Designed to satisfy OpenAI's
 * structured-output strict mode (which Codex's `--output-schema` uses):
 *   - every object schema declares `additionalProperties: false`
 *   - `required` lists every key in `properties` (nullable is the way
 *     to express optionality, not omission from `required`)
 *   - no `minLength` or other format constraints (strict mode rejects them)
 *
 * Backends that fall back to prompt injection (Gemini, Ollama, OpenCode)
 * still send this schema verbatim in the prompt, then parseVerdict()
 * validates the response and derives the verdict from severities.
 */
export const VERDICT_SCHEMA: object = {
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'verdict', 'summary', 'findings'],
  properties: {
    schema_version: { type: 'integer', enum: [VERDICT_SCHEMA_VERSION] },
    verdict: { type: 'string', enum: ['ship', 'iterate', 'abstain'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'rationale', 'location'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'important', 'nit'] },
          title: { type: 'string' },
          rationale: { type: 'string' },
          location: {
            type: ['string', 'null'],
          },
        },
      },
    },
  },
};

export const VERDICT_SCHEMA_JSON: string = JSON.stringify(VERDICT_SCHEMA);

export const DEFAULT_REVIEW_REQUEST =
  'Review the changes in this branch. Flag correctness, security, regression, and quality concerns; ignore style preferences unless they obscure intent.';

/**
 * System prompt for verdict mode. Instructs the model on the envelope shape
 * AND on the decision rule. The decision rule is enforced again at parse
 * time (parseVerdict overrides any contradictory verdict the model picks),
 * but stating it in the prompt reduces the rate of malformed outputs.
 *
 * The actual review request — either the caller's --prompt or the default
 * above — is composed into the prompt by buildVerdictPrompt(), so the
 * structured-output instructions never erase the caller's intent.
 */
export const VERDICT_INSTRUCTIONS = `Respond with a JSON object matching this exact shape (no preamble, no
explanation, JSON only):

  {
    "schema_version": 1,
    "verdict": "ship" | "iterate" | "abstain",
    "summary": "<one-paragraph synthesis of the review>",
    "findings": [
      {
        "severity": "blocker" | "important" | "nit",
        "title": "<short headline>",
        "rationale": "<1-3 sentences explaining the issue and what to change>",
        "location": "<file or file:line> or null"
      }
    ]
  }

Decision rule (the parser enforces this — do not contradict it):
- Any "blocker" or "important" finding => verdict MUST be "iterate".
- Empty findings, or only "nit" findings => verdict MUST be "ship".
- "abstain" is allowed only when you cannot make a confident call AND
  findings is empty.

Severity guide:
- "blocker": correctness, security, data integrity, or a regression. Must
  be fixed before merge.
- "important": meaningful concern that should be addressed before merge,
  but the reviewer can imagine a defensible counter-argument.
- "nit": optional polish. Style preference, naming, comment phrasing,
  micro-refactor. Never blocks merge.

Output ONLY the JSON object. No code fences, no markdown, no commentary.`;

/**
 * Combine the caller's review request (or the default if absent) with the
 * verdict envelope instructions. The caller's request always leads so the
 * model knows WHAT to review; the envelope rules tell it HOW to format.
 */
export function buildVerdictPrompt(reviewRequest: string | null | undefined): string {
  const request = reviewRequest && reviewRequest.trim().length > 0
    ? reviewRequest.trim()
    : DEFAULT_REVIEW_REQUEST;
  return `Review request:\n${request}\n\n${VERDICT_INSTRUCTIONS}`;
}

/** @deprecated kept for backwards-compat; prefer buildVerdictPrompt(). */
export const VERDICT_SYSTEM_PROMPT = buildVerdictPrompt(null);

export class VerdictParseError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = 'VerdictParseError';
    this.raw = raw;
  }
}

/**
 * Parse, validate, and derive-verdict for a model response. Always fails
 * closed: throws VerdictParseError on any malformed input, with the raw
 * response attached for stderr diagnostics.
 */
export function parseVerdict(raw: string): VerdictEnvelope {
  const trimmed = raw.trim();
  const stripped = stripJsonFence(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new VerdictParseError(
      `verdict response is not valid JSON: ${(err as Error).message}`,
      raw,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new VerdictParseError('verdict response must be a JSON object', raw);
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.schema_version !== VERDICT_SCHEMA_VERSION) {
    throw new VerdictParseError(
      `verdict schema_version mismatch: expected ${VERDICT_SCHEMA_VERSION}, got ${JSON.stringify(obj.schema_version)}`,
      raw,
    );
  }

  if (typeof obj.summary !== 'string' || obj.summary.length === 0) {
    throw new VerdictParseError('verdict summary must be a non-empty string', raw);
  }

  if (!Array.isArray(obj.findings)) {
    throw new VerdictParseError('verdict findings must be an array', raw);
  }

  const findings: Finding[] = obj.findings.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new VerdictParseError(`finding[${idx}] must be an object`, raw);
    }
    const f = item as Record<string, unknown>;
    if (
      f.severity !== 'blocker' &&
      f.severity !== 'important' &&
      f.severity !== 'nit'
    ) {
      throw new VerdictParseError(
        `finding[${idx}].severity must be one of blocker|important|nit, got ${JSON.stringify(f.severity)}`,
        raw,
      );
    }
    if (typeof f.title !== 'string' || f.title.length === 0) {
      throw new VerdictParseError(`finding[${idx}].title must be a non-empty string`, raw);
    }
    if (typeof f.rationale !== 'string' || f.rationale.length === 0) {
      throw new VerdictParseError(`finding[${idx}].rationale must be a non-empty string`, raw);
    }
    let location: string | null = null;
    if (f.location !== undefined && f.location !== null) {
      if (typeof f.location !== 'string' || f.location.length === 0) {
        throw new VerdictParseError(
          `finding[${idx}].location must be a non-empty string or null`,
          raw,
        );
      }
      location = f.location;
    }
    return {
      severity: f.severity,
      title: f.title,
      rationale: f.rationale,
      location,
    };
  });

  if (
    obj.verdict !== 'ship' &&
    obj.verdict !== 'iterate' &&
    obj.verdict !== 'abstain'
  ) {
    throw new VerdictParseError(
      `verdict must be one of ship|iterate|abstain, got ${JSON.stringify(obj.verdict)}`,
      raw,
    );
  }
  const claimedVerdict = obj.verdict;

  // Derive the canonical verdict from severities. A contradiction with the
  // model's self-reported verdict is treated as malformed output.
  const derived = deriveVerdict(findings, claimedVerdict);
  if (derived === null) {
    throw new VerdictParseError(
      `verdict ${JSON.stringify(claimedVerdict)} contradicts findings; ` +
        `severities=[${findings.map((f) => f.severity).join(', ')}]`,
      raw,
    );
  }

  return {
    schema_version: VERDICT_SCHEMA_VERSION,
    verdict: derived,
    summary: obj.summary,
    findings,
  };
}

/**
 * Decision rule. Returns the canonical verdict given the severity profile,
 * or null when the model's claimed verdict is contradictory and we should
 * fail closed.
 *
 * - any blocker|important -> 'iterate' (regardless of claim)
 * - else if claim === 'abstain' AND findings is empty -> 'abstain'
 * - else -> 'ship'
 */
export function deriveVerdict(
  findings: Finding[],
  claimed: VerdictKind,
): VerdictKind | null {
  const hasBlocking = findings.some(
    (f) => f.severity === 'blocker' || f.severity === 'important',
  );
  if (hasBlocking) {
    if (claimed === 'ship' || claimed === 'abstain') {
      return null;
    }
    return 'iterate';
  }
  // No blocker/important findings.
  if (claimed === 'abstain') {
    if (findings.length === 0) return 'abstain';
    return null;
  }
  if (claimed === 'iterate') {
    // Model says iterate but only nits exist — treat as malformed.
    return null;
  }
  return 'ship';
}

function stripJsonFence(text: string): string {
  // Some models wrap JSON in ```json ... ``` despite "JSON only" instructions.
  const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) return fence[1].trim();
  return text;
}

export function serializeVerdict(envelope: VerdictEnvelope): string {
  // Compact one-line JSON. Automation-first; humans pipe through jq.
  return JSON.stringify(envelope);
}

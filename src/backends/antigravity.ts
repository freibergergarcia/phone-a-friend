/**
 * Google Antigravity CLI backend implementation.
 *
 * Antigravity is not a Gemini CLI drop-in replacement. The user-facing
 * backend is named `antigravity`, while the executable is `agy`.
 *
 * Supports read-only relay/review with native conversation resume.
 */

import {
  type BackendCapabilities,
  type BackendRunOptions,
  BACKEND_COMMANDS,
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  SpawnCliError,
  spawnCli,
  SpawnCliTimeoutError,
  type Backend,
  type PreparePromptContext,
  type SandboxMode,
} from './index.js';

const ANTIGRAVITY_COMMAND = BACKEND_COMMANDS.antigravity ?? 'agy';
const OUTER_TIMEOUT_GRACE_SECONDS = 15;
const PRINT_TIMEOUT_PATTERN = /print timeout after/;
const STDERR_TAIL_CHARS = 2048;

export class AntigravityBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityBackendError';
  }
}

export function antigravityTimeoutRemediation(host: string): string {
  if (host === 'codex') {
    return (
      'Antigravity timed out under Codex\'s sandbox. Codex\'s default workspace-write ' +
      'sandbox can block subprocess OAuth/keychain access and outbound Google auth refresh. ' +
      'Re-run Codex with `codex --sandbox danger-full-access` (or `--full-auto`), ' +
      'or run the relay from a regular terminal.'
    );
  }
  return (
    'Antigravity timed out. Verify `agy --prompt "test"` works at the terminal ' +
    'and that your Google account is authenticated.'
  );
}

export class AntigravityBackend implements Backend {
  readonly name = 'antigravity';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
  ]);
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'native-session',
    requiresClientSessionId: false,
  };

  /**
   * Headless `agy` auto-denies the `command` permission and then returns
   * nothing, which is how every review used to fail: the model reached for
   * `git`. Workspace reads are granted, so say so up front. Verified live on
   * 1.2.11: the same review passes once the prompt carries this line.
   */
  preparePrompt(prompt: string, _ctx: PreparePromptContext): string {
    return `${ANTIGRAVITY_HEADLESS_PREAMBLE}\n\n${prompt}`;
  }

  async run(opts: BackendRunOptions): Promise<string> {
    if (!isInPath(ANTIGRAVITY_COMMAND, opts.env)) {
      throw new AntigravityBackendError(
        `Antigravity CLI not found in PATH. Install it: ${INSTALL_HINTS.antigravity}`,
      );
    }

    // Refuses unsupported non-string enums before anything is spawned.
    const schemaPlan = opts.schema ? planAntigravitySchema(opts.schema) : null;
    const args = buildAntigravityArgs({
      prompt: opts.prompt,
      repoPath: opts.repoPath,
      sandbox: opts.sandbox,
      model: opts.model,
      timeoutSeconds: opts.timeoutSeconds,
      persistSession: opts.persistSession,
      resumeSession: opts.resumeSession,
      sessionId: opts.sessionId,
      schema: opts.schema ?? null,
    });
    const session = Boolean(opts.persistSession || opts.resumeSession);
    const jsonEnvelope = session || Boolean(opts.schema);

    try {
      const result = await spawnCli(ANTIGRAVITY_COMMAND, args, {
        timeoutMs: (opts.timeoutSeconds + OUTER_TIMEOUT_GRACE_SECONDS) * 1000,
        env: opts.env,
        cwd: opts.repoPath,
        label: 'antigravity',
      });

      const host = opts.env.PHONE_A_FRIEND_HOST ?? '';
      if (!result.stdout) {
        throw emptyOutputError('antigravity completed without producing output', result.stderr, host);
      }

      if (!jsonEnvelope) {
        if (PRINT_TIMEOUT_PATTERN.test(result.stderr)) {
          throw partialTimeoutError(result.stdout, result.stderr, host);
        }
        return result.stdout;
      }

      // Session and schema modes share the JSON envelope and every guard
      // from the session work: status, response, print timeout, and (for
      // sessions) conversation id and resume identity, in that order. Only
      // then is the session linked or the structured value returned.
      const payload = parseAntigravityEnvelope(result.stdout, result.stderr, host);
      if (session) {
        const conversationId = typeof payload.conversation_id === 'string' ? payload.conversation_id.trim() : '';
        if (!conversationId) {
          throw new AntigravityBackendError('Antigravity session completed without a conversation_id');
        }
        if (opts.resumeSession && opts.sessionId && conversationId !== opts.sessionId) {
          throw new AntigravityBackendError(
            `Antigravity did not resume conversation ${opts.sessionId}; it started ${conversationId} instead.` +
              (stderrTail(result.stderr) ? `\nstderr: ${stderrTail(result.stderr)}` : ''),
          );
        }
        opts.onSessionCreated?.(conversationId);
      }
      if (!schemaPlan) return payload.response;
      const structured = structuredOutputOf(payload);
      if (schemaPlan.droppedEnums.length > 0) {
        let value: unknown;
        try {
          value = JSON.parse(structured);
        } catch {
          throw new AntigravityBackendError('Antigravity structured output is not valid JSON');
        }
        assertDroppedEnums(value, schemaPlan.droppedEnums);
      }
      return structured;
    } catch (err) {
      if (err instanceof AntigravityBackendError) throw err;
      if (err instanceof SpawnCliTimeoutError) {
        throw new AntigravityBackendError(
          `${err.message}. ${antigravityTimeoutRemediation(opts.env.PHONE_A_FRIEND_HOST ?? '')}`,
        );
      }
      if (err instanceof SpawnCliError) {
        throw new AntigravityBackendError(formatAntigravitySpawnError(err));
      }
      if (err instanceof BackendError) {
        throw new AntigravityBackendError(err.message);
      }
      throw err;
    }
  }
}

const ANTIGRAVITY_HEADLESS_PREAMBLE =
  'This is a headless session: shell and terminal commands are auto-denied. ' +
  'The Git Diff is included below when relevant. Use only file-viewing tools if you need more context.';

interface AntigravityEnvelope {
  status: string;
  response: string;
  conversation_id?: unknown;
  structured_output?: unknown;
}

/**
 * Validate the `--output-format json` envelope. Throws in the same order the
 * session path always has: invalid JSON, non-SUCCESS (detail from response,
 * error or message), empty response, print timeout with partial output.
 */
function parseAntigravityEnvelope(stdout: string, stderr: string, host: string): AntigravityEnvelope {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new AntigravityBackendError('Antigravity returned invalid session JSON');
  }
  if (payload?.status !== 'SUCCESS') {
    const detail = ([payload?.response, payload?.error, payload?.message]
      .find((value) => typeof value === 'string' && value.trim()) as string | undefined)?.trim() ?? '';
    throw new AntigravityBackendError(
      `Antigravity session failed with status: ${payload?.status ?? 'missing'}` +
        (detail ? `: ${detail}` : ''),
    );
  }
  if (typeof payload.response !== 'string' || !payload.response.trim()) {
    throw emptyOutputError('Antigravity session completed without producing a response', stderr, host);
  }
  if (PRINT_TIMEOUT_PATTERN.test(stderr)) {
    throw partialTimeoutError(payload.response, stderr, host);
  }
  return payload as unknown as AntigravityEnvelope;
}

/**
 * The schema-conforming value lives under `structured_output`; `response`
 * may carry extra keys the model added (verified on 1.2.11). Return the
 * value as JSON text only when the key is an own property and serializable
 * (functions and symbols stringify to undefined); otherwise fall back to the
 * validated response text.
 */
function structuredOutputOf(payload: AntigravityEnvelope): string {
  if (Object.prototype.hasOwnProperty.call(payload, 'structured_output')) {
    const text = JSON.stringify(payload.structured_output);
    if (typeof text === 'string') return text;
  }
  return payload.response;
}

interface AntigravityArgsOptions {
  prompt: string;
  repoPath: string;
  sandbox: SandboxMode;
  model: string | null;
  timeoutSeconds: number;
  persistSession?: boolean;
  resumeSession?: boolean;
  sessionId?: string | null;
  /** JSON Schema enforced natively via --json-schema; requires the JSON envelope. */
  schema?: string | null;
}

export function buildAntigravityArgs(opts: AntigravityArgsOptions): string[] {
  switch (opts.sandbox) {
    case 'read-only':
      break;
    case 'workspace-write':
    case 'danger-full-access':
      throw new AntigravityBackendError(
        `Antigravity backend currently supports read-only sandbox only, got: ${opts.sandbox}`,
      );
    default: {
      const exhaustive: never = opts.sandbox;
      throw new AntigravityBackendError(`Unsupported Antigravity sandbox: ${exhaustive}`);
    }
  }

  const args = [
    '--add-dir',
    opts.repoPath,
    '--print-timeout',
    `${opts.timeoutSeconds}s`,
    '--sandbox',
    '--mode',
    'plan',
  ];

  if (opts.model) {
    args.push('--model', opts.model);
  }

  if (opts.persistSession || opts.resumeSession || opts.schema) {
    args.push('--output-format', 'json');
  }
  if (opts.schema) {
    args.push('--json-schema', sanitizeAntigravitySchema(opts.schema));
  }
  if (opts.resumeSession && opts.sessionId) {
    args.push('--conversation', opts.sessionId);
  }

  args.push('--prompt', opts.prompt);
  return args;
}

/** A non-string enum PaF removed from the schema sent to agy, and where it applied. */
export interface DroppedEnum {
  /** JSON path segments from the root: a property name, or '[]' for every array item. */
  path: string[];
  values: unknown[];
}

export interface AntigravitySchemaPlan {
  schema: string;
  droppedEnums: DroppedEnum[];
}

/** True when a non-string enum appears anywhere inside `node`. */
function containsNonStringEnum(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(containsNonStringEnum);
  if (!node || typeof node !== 'object') return false;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'enum' && Array.isArray(value) && !value.every((v) => typeof v === 'string')) return true;
    if (containsNonStringEnum(value)) return true;
  }
  return false;
}

/**
 * The Gemini API behind agy accepts `enum` only with string values; an
 * integer enum such as the verdict envelope's `schema_version: [1]` fails the
 * whole request with INVALID_ARGUMENT (verified on 1.2.11). Remove non-string
 * enums from what is sent, remember where they were, and enforce them on the
 * returned value ourselves (see `assertDroppedEnums`), so the caller's schema
 * contract still holds.
 *
 * Only two locations map back to one response path: `properties.<name>` and
 * the object form of `items`. A non-string enum reachable any other way
 * (`anyOf`, `contains`, `$defs`, tuple `items`, `contentSchema`, anything
 * else) is refused before spawning rather than silently weakened. Unparseable
 * text is passed through for agy to report.
 */
export function planAntigravitySchema(schema: string): AntigravitySchemaPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(schema);
  } catch {
    return { schema, droppedEnums: [] };
  }
  const droppedEnums: DroppedEnum[] = [];
  const walk = (node: unknown, path: string[]): unknown => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    // Null-prototype maps: a schema may legally define a property named
    // __proto__, and assigning that key on a plain object would set the
    // prototype instead of creating the member.
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'enum' && Array.isArray(value) && !value.every((v) => typeof v === 'string')) {
        droppedEnums.push({ path: [...path], values: value });
        continue;
      }
      if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
        const props: Record<string, unknown> = Object.create(null);
        for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
          props[name] = walk(sub, [...path, name]);
        }
        out[key] = props;
        continue;
      }
      if (key === 'items' && value && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = walk(value, [...path, '[]']);
        continue;
      }
      if (containsNonStringEnum(value)) {
        throw new AntigravityBackendError(
          `Antigravity cannot enforce the non-string enum under \`${key}\` at $.${path.join('.') || '<root>'}: ` +
            'only enums directly under `properties.<name>` or an object-form `items` can be checked on the response. ' +
            'Use a string enum or restructure the schema.',
        );
      }
      out[key] = value;
    }
    return out;
  };
  const sanitized = walk(parsed, []);
  return { schema: JSON.stringify(sanitized), droppedEnums };
}

/** The schema text actually sent to agy. */
export function sanitizeAntigravitySchema(schema: string): string {
  return planAntigravitySchema(schema).schema;
}

/** JSON Schema equality: structural, with object member order ignored. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    return ka.length === kb.length
      && ka.every((key) => Object.prototype.hasOwnProperty.call(b, key)
        && jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

function isEnumMember(value: unknown, allowed: unknown[]): boolean {
  return allowed.some((candidate) => jsonEqual(candidate, value));
}

/** Enforce every enum PaF removed before sending, against the returned value. */
export function assertDroppedEnums(value: unknown, dropped: DroppedEnum[]): void {
  for (const entry of dropped) {
    const visit = (node: unknown, index: number, at: string[]): void => {
      if (index === entry.path.length) {
        if (!isEnumMember(node, entry.values)) {
          const where = at.length ? `$${at.map((s) => (s.startsWith('[') ? s : `.${s}`)).join('')}` : '$';
          throw new AntigravityBackendError(
            `Antigravity structured output violates the schema at ${where}: got ${JSON.stringify(node)}, ` +
              `expected one of ${JSON.stringify(entry.values)}.`,
          );
        }
        return;
      }
      const segment = entry.path[index];
      if (segment === '[]') {
        if (!Array.isArray(node)) return;
        node.forEach((item, i) => visit(item, index + 1, [...at, `[${i}]`]));
        return;
      }
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const record = node as Record<string, unknown>;
      // Own properties only: an omitted optional property named __proto__,
      // constructor or toString must not be "found" on Object.prototype.
      if (!Object.prototype.hasOwnProperty.call(record, segment)) return;
      visit(record[segment], index + 1, [...at, segment]);
    };
    visit(value, 0, []);
  }
}

function stderrTail(stderr: string): string {
  const detail = stderr.trim();
  return detail.length > STDERR_TAIL_CHARS ? `…${detail.slice(-STDERR_TAIL_CHARS)}` : detail;
}

function emptyOutputError(message: string, stderr: string, host: string): AntigravityBackendError {
  const detail = stderrTail(stderr);
  if (!detail) return new AntigravityBackendError(message);
  const remediation = PRINT_TIMEOUT_PATTERN.test(stderr) ? `\n${antigravityTimeoutRemediation(host)}` : '';
  return new AntigravityBackendError(`${message}\nstderr: ${detail}${remediation}`);
}

function partialTimeoutError(partial: string, stderr: string, host: string): AntigravityBackendError {
  return new AntigravityBackendError(
    'antigravity hit its print timeout and returned partial output; raise --timeout to allow more time\n' +
      `stderr: ${stderrTail(stderr)}\n${antigravityTimeoutRemediation(host)}\npartial output:\n${partial}`,
  );
}

function formatAntigravitySpawnError(err: SpawnCliError): string {
  const lines = [`Antigravity exited with code ${err.exitCode ?? 'unknown'}.`];
  if (err.stderr) lines.push(`stderr: ${err.stderr}`);
  if (err.stdout) lines.push(`stdout: ${err.stdout}`);
  if (!err.stderr && !err.stdout) lines.push(err.message);
  return lines.join('\n');
}

export const ANTIGRAVITY_BACKEND = new AntigravityBackend();
registerBackend(ANTIGRAVITY_BACKEND);

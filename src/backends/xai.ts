/** xAI Responses API with server-side web and X search. No local file access. */
import { longFetch } from './http-fetch.js';
import {
  BackendError, CONTEXT_HEADING, GIT_DIFF_HEADING, registerBackend, xaiApiKey, type Backend, type BackendCapabilities,
  type BackendRunOptions, type SandboxMode,
} from './index.js';

export class XaiBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'XaiBackendError';
  }
}

type JsonObject = Record<string, unknown>;
function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4.6';

/**
 * Search runs only on a bare prompt. Attached context or a diff may be private,
 * and a search tool is a way out for it. A pasted line starting `diff --git` is caught
 * too; other pasted text cannot be told apart from a question.
 */
const ATTACHED_CONTENT = new RegExp(`^(?:${GIT_DIFF_HEADING}|${CONTEXT_HEADING})$|^diff --git `, 'm');

function transportCode(err: unknown, key: string): string {
  const source = err as { code?: unknown; cause?: { code?: unknown } };
  const code = source.cause?.code ?? source.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? `: ${safeDetail(code, key)}` : '';
}

/** Decode JSON first, so a key written with JSON escapes cannot slip past redaction. */
function decodedBody(body: string): string {
  try { return JSON.stringify(JSON.parse(body)); } catch { return body; }
}

function safeDetail(detail: string, key: string): string {
  return detail.split(key).join('[REDACTED]').slice(0, 200);
}

function parseAnswer(response: JsonObject, key: string): { text: string; sources: string } {
  if (response.status !== 'completed' || response.error != null) {
    const error = asObject(response.error);
    const detail = [
      ['status', response.status ?? 'unknown'],
      ['reason', asObject(response.incomplete_details).reason],
      ['code', error.code],
      ['message', error.message],
    ].filter(([, value]) => typeof value === 'string').map(([name, value]) => `${name}=${value}`).join('; ');
    throw new XaiBackendError(`xAI response failed: ${safeDetail(detail, key)}`);
  }
  const parts: string[] = [];
  let refusal: string | null = null;
  const urls = new Set<string>();
  for (const item of asArray(response.output).map(asObject)) {
    // xAI documents `tool` as a message role too. Only the assistant's text is the answer.
    if (item.type !== 'message' || (item.role ?? 'assistant') !== 'assistant') continue;
    for (const part of asArray(item.content).map(asObject)) {
      if (part.type === 'refusal') refusal ??= String(part.refusal ?? 'no reason given');
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue;
      parts.push(part.text);
      for (const annotation of asArray(part.annotations).map(asObject)) {
        if (annotation.type === 'url_citation' && typeof annotation.url === 'string') {
          urls.add(annotation.url);
        }
      }
    }
  }
  const text = parts.join('\n').trim();
  if (!text && refusal !== null) throw new XaiBackendError(`xAI refused: ${safeDetail(refusal, key)}`);
  if (!text) throw new XaiBackendError('xAI completed without producing output');
  return { text, sources: urls.size ? `\n\nSources:\n${[...urls].map(url => `- ${url}`).join('\n')}` : '' };
}

export class XaiBackend implements Backend {
  readonly name = 'xai';
  readonly localFileAccess = false;
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'transcript-replay', requiresClientSessionId: false,
  };
  // Sandbox modes are a no-op: this backend has no local tools.
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set([
    'read-only', 'workspace-write', 'danger-full-access',
  ]);

  async run(opts: BackendRunOptions): Promise<string> {
    const key = xaiApiKey(opts.env);
    if (!key) throw new XaiBackendError('Set XAI_API_KEY to use xai. Get an API key at https://console.x.ai');
    let schema: unknown;
    if (opts.schema) {
      try { schema = JSON.parse(opts.schema); } catch { /* checked below */ }
      if (asObject(schema) !== schema) throw new XaiBackendError('--schema must be a JSON object for xai');
    }
    const history = opts.sessionHistory ?? [];
    const searchAllowed = ![opts.prompt, ...history.map(turn => turn.content)].some(content => ATTACHED_CONTENT.test(content));
    if (!searchAllowed) console.error('[phone-a-friend] xai: web and X search are off because this conversation has attached context or a diff.');
    const controller = new AbortController();
    const timer = opts.timeoutSeconds > 0
      ? setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000)
      : undefined;
    try {
      const resp = await longFetch(RESPONSES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: opts.model ?? DEFAULT_MODEL,
          input: [...history, { role: 'user', content: opts.prompt }],
          ...(searchAllowed ? { tools: [{ type: 'web_search' }, { type: 'x_search' }] } : {}),
          stream: false,
          store: false,
          ...(schema ? { text: { format: {
            type: 'json_schema', name: 'paf_response', schema, strict: true,
          } } } : {}),
        }),
        signal: controller.signal,
      });
      let body: string;
      try { body = await resp.text(); }
      catch { throw new XaiBackendError(`xAI response body could not be read (HTTP ${resp.status})`); }
      if (!resp.ok) {
        throw new XaiBackendError(`xAI returned HTTP ${resp.status}: ${safeDetail(decodedBody(body), key)}`);
      }
      let data: unknown;
      try { data = JSON.parse(body); }
      catch { throw new XaiBackendError(`xAI returned invalid JSON (HTTP ${resp.status})`); }
      const result = parseAnswer(asObject(data), key);
      return result.text + (opts.schema ? '' : result.sources);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new XaiBackendError(`xAI timed out after ${opts.timeoutSeconds}s`);
      }
      if (err instanceof XaiBackendError) throw err;
      throw new XaiBackendError(`xAI request failed${transportCode(err, key)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const XAI_BACKEND = new XaiBackend();
registerBackend(XAI_BACKEND);

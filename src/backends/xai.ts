/** xAI Responses API with server-side web and X search. No local file access. */
import {
  BackendError, registerBackend, type Backend, type BackendCapabilities,
  type BackendRunOptions, type SandboxMode,
} from './index.js';

export class XaiBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'XaiBackendError';
  }
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function answer(response: JsonObject): { text: string; sources: string } {
  if (response.status !== 'completed' || response.error != null) {
    throw new XaiBackendError('xAI response failed');
  }
  const parts: string[] = [];
  const urls = new Set<string>();
  for (const item of array(response.output).map(object)) {
    if (item.type !== 'message') continue;
    for (const part of array(item.content).map(object)) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue;
      parts.push(part.text);
      for (const annotation of array(part.annotations).map(object)) {
        if (annotation.type === 'url_citation' && typeof annotation.url === 'string') {
          urls.add(annotation.url);
        }
      }
    }
  }
  const text = parts.join('\n').trim();
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
    const key = opts.env.XAI_API_KEY?.trim();
    if (!key) throw new XaiBackendError('Set XAI_API_KEY to use xai. Get an API key at https://console.x.ai');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000);
    try {
      const prompt = opts.schema
        ? `${opts.prompt}\n\nRespond with JSON only. The response must match this JSON Schema exactly:\n${opts.schema}`
        : opts.prompt;
      const resp = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: opts.model ?? 'grok-4.6',
          input: [...(opts.sessionHistory ?? []), { role: 'user', content: prompt }],
          tools: [{ type: 'web_search' }, { type: 'x_search' }],
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        let detail = '';
        try { detail = await resp.text(); } catch { /* status still available */ }
        detail = detail.split(key).join('[REDACTED]').slice(0, 200);
        throw new XaiBackendError(`xAI returned HTTP ${resp.status}: ${detail}`);
      }
      let data: unknown;
      try { data = await resp.json(); }
      catch { throw new XaiBackendError(`xAI returned invalid JSON (HTTP ${resp.status})`); }
      const result = answer(object(data));
      return result.text + (opts.schema ? '' : result.sources);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new XaiBackendError(`xAI timed out after ${opts.timeoutSeconds}s`);
      }
      if (err instanceof XaiBackendError) throw err;
      throw new XaiBackendError('xAI request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const XAI_BACKEND = new XaiBackend();
registerBackend(XAI_BACKEND);

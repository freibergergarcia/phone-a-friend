/**
 * Ollama backend implementation.
 *
 * Unlike Codex/Gemini (subprocess CLI), Ollama is an HTTP API backend
 * using native fetch to POST to localhost:11434/api/chat.
 *
 * Sandbox is a no-op — Ollama is pure inference.
 */

import {
  BackendError,
  registerBackend,
  type Backend,
  type SandboxMode,
} from './index.js';
import { parseNDJSONStream } from '../stream-parsers.js';

const DEFAULT_HOST = 'http://localhost:11434';

export class OllamaBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaBackendError';
  }
}

export class OllamaBackend implements Backend {
  readonly name = 'ollama';
  readonly localFileAccess = false;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);

  async run(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): Promise<string> {
    const host = (opts.env.OLLAMA_HOST ?? DEFAULT_HOST).replace(/\/+$/, '');
    const model = opts.model ?? opts.env.OLLAMA_MODEL ?? undefined;

    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: opts.prompt }],
      stream: false,
    };
    if (model) body.model = model;

    const url = `${host}/api/chat`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000);

    let data: Record<string, unknown>;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        let body = '';
        try { body = await resp.text(); } catch { /* ignore */ }
        throw new OllamaBackendError(
          `Ollama returned HTTP ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        );
      }

      let raw: unknown;
      try {
        raw = await resp.json();
      } catch {
        throw new OllamaBackendError(
          `Ollama returned invalid JSON (HTTP ${resp.status})`,
        );
      }
      data = raw as Record<string, unknown>;
    } catch (err: unknown) {
      if (err instanceof OllamaBackendError) throw err;
      clearTimeout(timer);
      return this.diagnoseAndThrow(host, err, opts.timeoutSeconds);
    } finally {
      clearTimeout(timer);
    }

    // Handle error field in response body
    if (data.error) {
      throw new OllamaBackendError(`Ollama error: ${data.error}`);
    }

    const message = data.message as Record<string, unknown> | undefined;
    const content = ((message?.content as string) ?? '').trim();

    if (!content) {
      throw new OllamaBackendError(
        'Ollama completed without producing output',
      );
    }
    return content;
  }

  async *runStream(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): AsyncGenerator<string> {
    const host = (opts.env.OLLAMA_HOST ?? DEFAULT_HOST).replace(/\/+$/, '');
    const model = opts.model ?? opts.env.OLLAMA_MODEL ?? undefined;

    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: opts.prompt }],
      stream: true,
    };
    if (model) body.model = model;

    const url = `${host}/api/chat`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      // diagnoseAndThrow always throws (Promise<never>)
      return void (await this.diagnoseAndThrow(host, err, opts.timeoutSeconds));
    }

    if (!resp.ok) {
      clearTimeout(timer);
      let respBody = '';
      try { respBody = await resp.text(); } catch { /* ignore */ }
      throw new OllamaBackendError(
        `Ollama returned HTTP ${resp.status}${respBody ? `: ${respBody.slice(0, 200)}` : ''}`,
      );
    }

    if (!resp.body) {
      clearTimeout(timer);
      throw new OllamaBackendError('Ollama returned empty response body');
    }

    try {
      yield* parseNDJSONStream(resp.body, controller.signal);
    } catch (err: unknown) {
      if (err instanceof OllamaBackendError) throw err;
      // Parser/protocol errors (stream error, unexpected EOF, abort) → wrap directly.
      // Transport errors (AbortError from timeout) → diagnose connectivity.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('Stream ')) {
        throw new OllamaBackendError(msg);
      }
      await this.diagnoseAndThrow(host, err, opts.timeoutSeconds);
    } finally {
      clearTimeout(timer);
    }
  }

  private async diagnoseAndThrow(
    host: string,
    originalErr: unknown,
    timeout: number,
  ): Promise<never> {
    // Abort / timeout
    if (
      originalErr instanceof DOMException ||
      (originalErr instanceof Error && originalErr.name === 'AbortError')
    ) {
      throw new OllamaBackendError(
        `Ollama timed out after ${timeout}s`,
      );
    }

    // Quick reachability probe
    const controller = new AbortController();
    const probeTimer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`${host}/api/tags`, { signal: controller.signal });
    } catch {
      // Server not reachable at all
      throw new OllamaBackendError(
        `Ollama server not reachable at ${host}. Is Ollama running? Install: https://ollama.com/download`,
      );
    } finally {
      clearTimeout(probeTimer);
    }

    // Server is reachable but /api/chat failed
    const detail = originalErr instanceof Error ? originalErr.message : String(originalErr);
    throw new OllamaBackendError(`Ollama request failed: ${detail}`);
  }
}

export const OLLAMA_BACKEND = new OllamaBackend();
registerBackend(OLLAMA_BACKEND);

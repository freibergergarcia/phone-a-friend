/**
 * Codex backend implementation.
 *
 * Ported from phone_a_friend/backends/codex.py
 */

import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  type BackendRunOptions,
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
  SpawnCliError,
  spawnCli,
  type Backend,
  type ReviewOptions,
  type SandboxMode,
} from './index.js';

export class CodexBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'CodexBackendError';
  }
}

export class CodexBackend implements Backend {
  readonly name = 'codex';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);

  async run(opts: BackendRunOptions): Promise<string> {
    if (!isInPath('codex')) {
      throw new CodexBackendError(
        `codex CLI not found in PATH. Install it: ${INSTALL_HINTS.codex}`,
      );
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'phone-a-friend-'));
    const outputPath = join(tmpDir, 'codex-last-message.txt');
    const schemaPath = opts.schema ? join(tmpDir, 'codex-output-schema.json') : null;

    try {
      const args = buildCodexExecArgs({
        prompt: opts.prompt,
        repoPath: opts.repoPath,
        sandbox: opts.sandbox,
        model: opts.model,
        outputPath,
        schemaPath,
        persistSession: opts.persistSession ?? false,
        sessionId: opts.sessionId ?? null,
        resumeSession: opts.resumeSession ?? false,
      });

      if (schemaPath) {
        writeSchemaFile(schemaPath, opts.schema ?? '');
      }

      let stdout = '';
      try {
        const result = await spawnCli('codex', args, {
          timeoutMs: opts.timeoutSeconds * 1000,
          env: opts.env,
          label: 'codex exec',
        });
        stdout = result.stdout;
        maybeEmitSessionId(stdout, opts.onSessionCreated);
      } catch (err: unknown) {
        if (err instanceof SpawnCliError) {
          maybeEmitSessionId(err.stdout, opts.onSessionCreated);
        }

        // On failure, check if codex wrote a useful last-message before dying
        const lastMessage = readOutputFile(outputPath);
        if (lastMessage) return lastMessage;

        if (err instanceof BackendError) {
          throw new CodexBackendError(err.message);
        }
        throw err;
      }

      // Read output file (preferred)
      const lastMessage = readOutputFile(outputPath);
      if (lastMessage) {
        return lastMessage;
      }

      // Fall back to stdout
      if (stdout) {
        return stdout;
      }

      throw new CodexBackendError('codex exec completed without producing feedback');
    } finally {
      // Clean up temp directory
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  async review(opts: ReviewOptions): Promise<string> {
    if (!isInPath('codex')) {
      throw new CodexBackendError(
        `codex CLI not found in PATH. Install it: ${INSTALL_HINTS.codex}`,
      );
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'phone-a-friend-'));
    const outputPath = join(tmpDir, 'codex-last-message.txt');

    try {
      const args = [
        'exec',
        'review',
        '-C',
        opts.repoPath,
        '--base',
        opts.base,
        '--sandbox',
        opts.sandbox,
        '--output-last-message',
        outputPath,
      ];

      if (opts.model) {
        args.push('-m', opts.model);
      }

      if (opts.prompt) {
        args.push(opts.prompt);
      }

      let stdout = '';
      try {
        const result = await spawnCli('codex', args, {
          timeoutMs: opts.timeoutSeconds * 1000,
          env: opts.env,
          label: 'codex exec review',
        });
        stdout = result.stdout;
      } catch (err: unknown) {
        // On failure, check if codex wrote a useful last-message before dying
        const lastMessage = readOutputFile(outputPath);
        if (lastMessage) return lastMessage;

        if (err instanceof BackendError) {
          throw new CodexBackendError(err.message);
        }
        throw err;
      }

      const lastMessage = readOutputFile(outputPath);
      if (lastMessage) {
        return lastMessage;
      }

      if (stdout) {
        return stdout;
      }

      throw new CodexBackendError('codex exec review completed without producing feedback');
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

interface CodexExecArgsOptions {
  prompt: string;
  repoPath: string;
  sandbox: SandboxMode;
  model: string | null;
  outputPath: string;
  schemaPath: string | null;
  persistSession: boolean;
  sessionId: string | null;
  resumeSession: boolean;
}

interface CodexMetadata {
  threadId?: string;
  usage?: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
  failed?: boolean;
}

function buildCodexExecArgs(opts: CodexExecArgsOptions): string[] {
  const isResume = opts.resumeSession && opts.sessionId;
  const args = isResume
    ? ['exec', 'resume', opts.sessionId!]
    : ['exec'];

  // codex exec resume only accepts: --skip-git-repo-check, --ephemeral, --json, -o, -m
  // Full exec accepts: -C, --sandbox, --output-last-message, and all the above
  if (isResume) {
    args.push('-o', opts.outputPath);
  } else {
    args.push(
      '-C',
      opts.repoPath,
      '--sandbox',
      opts.sandbox,
      '--output-last-message',
      opts.outputPath,
    );
  }

  args.push('--skip-git-repo-check');

  if (!isResume && !opts.persistSession) {
    args.push('--ephemeral');
  }

  // exec resume does not accept --output-schema; only --json is allowed
  if (opts.schemaPath && !isResume) {
    args.push('--output-schema', opts.schemaPath, '--json');
  } else if (opts.persistSession || isResume) {
    args.push('--json');
  }

  if (opts.model) {
    args.push('-m', opts.model);
  }

  args.push(opts.prompt);
  return args;
}

function writeSchemaFile(schemaPath: string, schema: string): void {
  try {
    writeFileSync(schemaPath, schema, 'utf-8');
  } catch (err) {
    throw new CodexBackendError(`Failed writing Codex schema file: ${err}`);
  }
}

function maybeEmitSessionId(
  jsonlOutput: string,
  onSessionCreated?: (sessionId: string) => void,
): void {
  const threadId = parseCodexMetadata(jsonlOutput).threadId;
  if (threadId && onSessionCreated) {
    onSessionCreated(threadId);
  }
}

export function parseCodexMetadata(jsonlOutput: string): CodexMetadata {
  const meta: CodexMetadata = {};
  for (const line of jsonlOutput.trim().split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        meta.threadId = event.thread_id;
      }
      if (event.type === 'turn.completed' && typeof event.usage === 'object' && event.usage !== null) {
        meta.usage = event.usage as CodexMetadata['usage'];
      }
      if (event.type === 'turn.failed') {
        meta.failed = true;
      }
    } catch {
      // Ignore malformed JSONL lines from mixed stdout.
    }
  }
  return meta;
}

function readOutputFile(outputPath: string): string {
  if (!existsSync(outputPath)) {
    return '';
  }
  try {
    return readFileSync(outputPath, 'utf-8').trim();
  } catch (err) {
    throw new CodexBackendError(
      `Failed reading Codex output file: ${err}`,
    );
  }
}

export const CODEX_BACKEND = new CodexBackend();
registerBackend(CODEX_BACKEND);

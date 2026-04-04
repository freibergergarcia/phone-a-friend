/**
 * Codex backend implementation.
 *
 * Ported from phone_a_friend/backends/codex.py
 */

import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BackendError,
  INSTALL_HINTS,
  isInPath,
  registerBackend,
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

  async run(opts: {
    prompt: string;
    repoPath: string;
    timeoutSeconds: number;
    sandbox: SandboxMode;
    model: string | null;
    env: Record<string, string>;
  }): Promise<string> {
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
        '-C',
        opts.repoPath,
        '--skip-git-repo-check',
        '--sandbox',
        opts.sandbox,
        '--output-last-message',
        outputPath,
      ];

      if (opts.model) {
        args.push('-m', opts.model);
      }

      args.push(opts.prompt);

      let stdout = '';
      try {
        const result = await spawnCli('codex', args, {
          timeoutMs: opts.timeoutSeconds * 1000,
          env: opts.env,
          label: 'codex exec',
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

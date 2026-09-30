/**
 * pi backend implementation (`@earendil-works/pi-coding-agent`).
 *
 * Subprocess backend using `pi --mode json`, which streams JSONL events and
 * exits when the prompt is done. pi has no sandbox and no `--dir` flag:
 *
 * - The PaF sandbox maps to pi's `--tools` allowlist. `read-only` means the
 *   model has no write or shell tool in that invocation; it is not OS
 *   isolation, and pi still runs with the user's permissions.
 * - `-ne` and `--no-approve` are always passed. Extensions run inside pi and
 *   can re-enable any built-in tool, so without them the allowlist would not
 *   be authoritative.
 * - The working directory selects the project, so every spawn uses the repo
 *   as cwd.
 */

import { BackendError, type SandboxMode } from './index.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PiBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'PiBackendError';
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * Tool allowlist per sandbox. `workspace-write` has no `bash`: a shell can
 * write anywhere, which would erase the difference from full access.
 */
const PI_TOOLS: Record<SandboxMode, string> = {
  'read-only': 'read,grep,find,ls',
  'workspace-write': 'read,grep,find,ls,edit,write',
  'danger-full-access': 'read,grep,find,ls,edit,write,bash',
};

/** pi's own session ID rule (`assertValidSessionId` in its session manager). */
const PI_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function isValidPiSessionId(id: string): boolean {
  return PI_SESSION_ID_PATTERN.test(id);
}

export interface PiArgsOptions {
  prompt: string;
  sandbox: SandboxMode;
  model: string | null;
  /** From `[backends.pi] provider`. Passed separately from the model, whose ID may contain "/". */
  provider: string | null;
  /** `--fast`: skip context files and skills. */
  fast: boolean;
  /**
   * A PaF-owned session (directory plus exact ID), or `null` for an
   * ephemeral run. One field, so a call can never carry both `--no-session`
   * and `--session-id`.
   */
  session: { dir: string; id: string } | null;
}

/**
 * Build the pi argument vector. Pure and exported so the security-relevant
 * flags (`--tools`, `-ne`, `--no-approve`, session storage) are unit-testable
 * without spawning a subprocess.
 */
export function buildPiArgs(opts: PiArgsOptions): string[] {
  const args = ['--mode', 'json', '--no-approve'];

  if (opts.session) {
    if (!isValidPiSessionId(opts.session.id)) {
      throw new PiBackendError(
        `Invalid pi session ID "${opts.session.id}". pi session IDs use letters, digits, ".", "_" and "-", ` +
          'and start and end with a letter or digit.',
      );
    }
    args.push('--session-dir', opts.session.dir, '--session-id', opts.session.id);
  } else {
    // pi saves every run unless told otherwise.
    args.push('--no-session');
  }

  args.push('-ne', '-np', '--no-themes', '--tools', PI_TOOLS[opts.sandbox]);

  if (opts.provider) args.push('--provider', opts.provider);
  if (opts.model) args.push('--model', opts.model);
  if (opts.fast) args.push('-nc', '-ns');

  // `--` keeps a prompt that begins with "-" from being parsed as a flag. It
  // does not stop `@file` handling: pi reads a positional argument starting
  // with "@" as a file include even after `--`, so such a prompt gets a
  // leading newline and stays a message.
  args.push('--', opts.prompt.startsWith('@') ? `\n${opts.prompt}` : opts.prompt);
  return args;
}

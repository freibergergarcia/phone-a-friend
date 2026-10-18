/**
 * Grok Build CLI backend.
 *
 * Headless `grok --prompt-file` with `--output-format json`. Sandbox and
 * permission mode are separate: the sandbox limits an approved call, and
 * `dontAsk` (limited modes) or `bypassPermissions` (full access) keeps the
 * relay from sitting on an approval prompt until timeout. `acceptEdits` is
 * not used: an unmatched Bash call still prompts, which hangs the relay.
 * There is no native review and no resume yet (a returned sessionId is not
 * a session PaF can continue).
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import {
  BackendError,
  SpawnCliError,
  SpawnCliTimeoutError,
  registerBackend,
  spawnCli,
  type Backend,
  type BackendCapabilities,
  type BackendRunOptions,
  type SandboxMode,
} from './index.js';

export class GrokBackendError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = 'GrokBackendError';
  }
}

// grok 1.0.62 reports end_turn for a normal completion. stop and length stay
// accepted so a build that uses those names still returns the answer text.
const FINISHED_STOP_REASONS = new Set(['stop', 'length', 'end_turn']);

export const GROK_SCHEMA_UNSUPPORTED =
  'Grok structured output is not supported yet. phone-a-friend --to grok cannot be combined with --schema or --verdict-json.';

/**
 * Grok sets `GROK_AGENT=1` on every child it launches. `PHONE_A_FRIEND_HOST=grok`
 * is the explicit marker the skill sets, including for a caller that did not
 * arrive through Grok's shell.
 */
export function isGrokHostEnv(env: Record<string, string | undefined>): boolean {
  return env.GROK_AGENT === '1' || env.PHONE_A_FRIEND_HOST?.toLowerCase() === 'grok';
}

function assertNotGrokHost(env: Record<string, string>): void {
  if (!isGrokHostEnv(env)) return;
  throw new GrokBackendError(
    'Grok is already the host for this Phone-a-Friend invocation. ' +
      'Choose another friend backend such as antigravity, codex, gemini, claude, opencode, pi, or ollama.',
  );
}

export interface GrokArgOptions {
  promptFile: string;
  repoPath: string;
  sandbox: SandboxMode;
  model: string | null;
}

/**
 * Arguments for one headless run. `--fast` is intentionally absent: Grok has
 * no flag that skips project instructions, so a fast request adds nothing.
 */
export function buildGrokArgs(opts: GrokArgOptions): string[] {
  const args = [
    '--no-auto-update',
    '--output-format', 'json',
    '--cwd', opts.repoPath,
    '--prompt-file', opts.promptFile,
  ];
  if (opts.model) args.push('-m', opts.model);

  // dontAsk denies any tool that is not allowed, so a Bash call cannot sit
  // on an approval prompt until timeout. --deny Bash also wins over a
  // project allow rule. acceptEdits would still prompt for Bash.
  switch (opts.sandbox) {
    case 'read-only':
      args.push(
        '--sandbox', 'read-only',
        '--permission-mode', 'dontAsk',
        '--allow', 'Read',
        '--allow', 'Grep',
        '--deny', 'Bash',
      );
      break;
    case 'workspace-write':
      args.push(
        '--sandbox', 'workspace',
        '--permission-mode', 'dontAsk',
        '--allow', 'Read',
        '--allow', 'Grep',
        '--allow', 'Edit',
        '--allow', 'Write',
        '--deny', 'Bash',
      );
      break;
    case 'danger-full-access':
      args.push('--sandbox', 'off', '--permission-mode', 'bypassPermissions');
      break;
  }
  return args;
}

/**
 * Pull the answer out of Grok's `--output-format json` envelope.
 * Exit 0 is not success: only a finished stop reason with text is an answer.
 */
export function parseGrokResult(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new GrokBackendError('Grok returned output that is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GrokBackendError('Grok returned JSON that is not a result object.');
  }
  const record = parsed as Record<string, unknown>;
  if (record.type === 'error') {
    const message = typeof record.message === 'string' && record.message.trim() !== ''
      ? record.message.trim()
      : 'Grok returned an error envelope.';
    throw new GrokBackendError(`Grok returned an error: ${message}`);
  }
  const stopReason = record.stopReason;
  const text = record.text;
  if (
    typeof stopReason === 'string' &&
    FINISHED_STOP_REASONS.has(stopReason) &&
    typeof text === 'string' &&
    text.trim() !== ''
  ) {
    return text;
  }
  const reason = typeof stopReason === 'string' ? stopReason : 'missing';
  throw new GrokBackendError(`Grok did not return a finished answer (stopReason: ${reason}).`);
}

function canonicalRepoPath(repoPath: string): string {
  try {
    return realpathSync(resolvePath(repoPath));
  } catch (err) {
    throw new GrokBackendError(
      `Repository path cannot be resolved: ${repoPath} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function writePromptFile(prompt: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'paf-grok-'));
  const file = join(dir, 'prompt.txt');
  try {
    writeFileSync(file, prompt, 'utf8');
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, file };
}

function grokFailureText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
      return parsed.message.trim().slice(0, 500);
    }
  } catch {
    // Non-JSON stdout is still the best failure detail Grok left us.
  }
  return trimmed.slice(0, 500);
}

const GROK_KILL_GRACE_MS = 2_000;

function toGrokError(err: unknown, timeoutSeconds: number): GrokBackendError {
  if (err instanceof GrokBackendError) return err;
  if (err instanceof SpawnCliTimeoutError) {
    return new GrokBackendError(`Grok timed out after ${timeoutSeconds}s`);
  }
  if (err instanceof SpawnCliError) {
    const detail = err.stderr.trim() || grokFailureText(err.stdout) || err.message;
    return new GrokBackendError(
      `Grok exited with code ${err.exitCode ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
    );
  }
  if (err instanceof BackendError) return new GrokBackendError(err.message);
  return new GrokBackendError(err instanceof Error ? err.message : String(err));
}

export class GrokBackend implements Backend {
  readonly name = 'grok';
  readonly localFileAccess = true;
  readonly allowedSandboxes: ReadonlySet<SandboxMode> = new Set<SandboxMode>([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]);
  readonly capabilities: BackendCapabilities = {
    resumeStrategy: 'unsupported',
    requiresClientSessionId: false,
  };

  async run(opts: BackendRunOptions): Promise<string> {
    assertNotGrokHost(opts.env);
    if (opts.schema) throw new GrokBackendError(GROK_SCHEMA_UNSUPPORTED);

    const repoCwd = canonicalRepoPath(opts.repoPath);
    const promptFile = writePromptFile(opts.prompt);
    try {
      const args = buildGrokArgs({
        promptFile: promptFile.file,
        repoPath: repoCwd,
        sandbox: opts.sandbox,
        model: opts.model,
      });
      const result = await spawnCli('grok', args, {
        timeoutMs: opts.timeoutSeconds * 1000,
        env: opts.env,
        cwd: repoCwd,
        label: 'grok',
        killGraceMs: GROK_KILL_GRACE_MS,
      });
      return parseGrokResult(result.stdout);
    } catch (err: unknown) {
      throw toGrokError(err, opts.timeoutSeconds);
    } finally {
      rmSync(promptFile.dir, { recursive: true, force: true });
    }
  }
}

export const GROK_BACKEND = new GrokBackend();
registerBackend(GROK_BACKEND);

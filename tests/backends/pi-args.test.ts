import { describe, expect, it } from 'vitest';
import { buildPiArgs, PiBackendError, type PiArgsOptions } from '../../src/backends/pi.js';
import type { SandboxMode } from '../../src/backends/index.js';

const SESSION_DIR = '/config/phone-a-friend/pi-sessions';
const SESSION_ID = '0b9d6c1e-6f0a-4b7e-9c55-2f3d1a4e8b10';

function opts(overrides: Partial<PiArgsOptions> = {}): PiArgsOptions {
  return {
    prompt: 'Review this code',
    sandbox: 'read-only',
    model: null,
    provider: null,
    fast: false,
    session: null,
    ...overrides,
  };
}

function count(args: string[], flag: string): number {
  return args.filter((arg) => arg === flag).length;
}

describe('buildPiArgs()', () => {
  it('builds the exact read-only vector for a plain relay', () => {
    expect(buildPiArgs(opts())).toEqual([
      '--mode', 'json',
      '--no-approve',
      '--no-session',
      '-ne',
      '-np', '--no-themes',
      '--tools', 'read,grep,find,ls',
      '--', 'Review this code',
    ]);
  });

  it('pins the tool list for every sandbox', () => {
    const tools = (sandbox: SandboxMode): string => {
      const args = buildPiArgs(opts({ sandbox }));
      return args[args.indexOf('--tools') + 1];
    };
    expect(tools('read-only')).toBe('read,grep,find,ls');
    expect(tools('workspace-write')).toBe('read,grep,find,ls,edit,write');
    expect(tools('danger-full-access')).toBe('read,grep,find,ls,edit,write,bash');
  });

  it('never offers a shell outside danger-full-access, nor a write tool in read-only', () => {
    const toolsOf = (sandbox: SandboxMode): string[] => {
      const args = buildPiArgs(opts({ sandbox }));
      return args[args.indexOf('--tools') + 1].split(',');
    };
    expect(toolsOf('read-only')).not.toContain('bash');
    expect(toolsOf('read-only')).not.toContain('edit');
    expect(toolsOf('read-only')).not.toContain('write');
    expect(toolsOf('workspace-write')).not.toContain('bash');
  });

  it('always passes --no-approve and -ne, in every sandbox and mode', () => {
    const sandboxes: SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access'];
    for (const sandbox of sandboxes) {
      for (const fast of [false, true]) {
        for (const session of [null, { dir: SESSION_DIR, id: SESSION_ID }]) {
          const args = buildPiArgs(opts({ sandbox, fast, session }));
          expect(count(args, '--no-approve')).toBe(1);
          expect(count(args, '-ne')).toBe(1);
          expect(count(args, '--tools')).toBe(1);
        }
      }
    }
  });

  it('carries exactly one of --no-session or (--session-dir + --session-id), never both', () => {
    const plain = buildPiArgs(opts());
    expect(count(plain, '--no-session')).toBe(1);
    expect(plain).not.toContain('--session-dir');
    expect(plain).not.toContain('--session-id');

    const session = buildPiArgs(opts({ session: { dir: SESSION_DIR, id: SESSION_ID } }));
    expect(session).not.toContain('--no-session');
    expect(count(session, '--session-dir')).toBe(1);
    expect(count(session, '--session-id')).toBe(1);
    expect(session[session.indexOf('--session-dir') + 1]).toBe(SESSION_DIR);
    expect(session[session.indexOf('--session-id') + 1]).toBe(SESSION_ID);
  });

  it('builds the exact vector for a session call', () => {
    expect(buildPiArgs(opts({ session: { dir: SESSION_DIR, id: SESSION_ID } }))).toEqual([
      '--mode', 'json',
      '--no-approve',
      '--session-dir', SESSION_DIR, '--session-id', SESSION_ID,
      '-ne',
      '-np', '--no-themes',
      '--tools', 'read,grep,find,ls',
      '--', 'Review this code',
    ]);
  });

  it('rejects a session id that pi would refuse', () => {
    for (const id of ['', '-leading', 'trailing-', 'has space', 'a/b', '../up']) {
      expect(() => buildPiArgs(opts({ session: { dir: SESSION_DIR, id } }))).toThrow(PiBackendError);
    }
    expect(() => buildPiArgs(opts({ session: { dir: SESSION_DIR, id: 'a.b_c-1' } }))).not.toThrow();
  });

  it('passes provider and model separately, each only when set', () => {
    const model = 'mlx-community/Qwen3.5-9B-MLX-4bit';
    const both = buildPiArgs(opts({ provider: 'mlx', model }));
    expect(both.slice(both.indexOf('--provider'), both.indexOf('--provider') + 4)).toEqual([
      '--provider', 'mlx', '--model', model,
    ]);

    const modelOnly = buildPiArgs(opts({ model: `mlx/${model}` }));
    expect(modelOnly).not.toContain('--provider');
    expect(modelOnly[modelOnly.indexOf('--model') + 1]).toBe(`mlx/${model}`);

    const providerOnly = buildPiArgs(opts({ provider: 'mlx' }));
    expect(providerOnly[providerOnly.indexOf('--provider') + 1]).toBe('mlx');
    expect(providerOnly).not.toContain('--model');

    const neither = buildPiArgs(opts());
    expect(neither).not.toContain('--provider');
    expect(neither).not.toContain('--model');
  });

  it('maps --fast to -nc -ns and leaves context files and skills on otherwise', () => {
    const fast = buildPiArgs(opts({ fast: true }));
    expect(fast).toContain('-nc');
    expect(fast).toContain('-ns');
    const normal = buildPiArgs(opts());
    expect(normal).not.toContain('-nc');
    expect(normal).not.toContain('-ns');
  });

  it('puts the prompt last, after --, so a leading dash is not parsed as a flag', () => {
    const args = buildPiArgs(opts({ prompt: '--mode text is a flag', provider: 'mlx', fast: true }));
    expect(args.slice(-2)).toEqual(['--', '--mode text is a flag']);
    expect(count(args, '--')).toBe(1);
  });

  it('prefixes a newline to a prompt starting with @ so pi does not read it as a file', () => {
    // pi 0.87.1 treats a positional argument starting with "@" as a file
    // include even after "--" (verified live in step 0).
    const args = buildPiArgs(opts({ prompt: '@secrets.txt summarise' }));
    expect(args[args.length - 1]).toBe('\n@secrets.txt summarise');
    expect(args[args.length - 1].startsWith('@')).toBe(false);
    // An "@" anywhere else is ordinary text.
    const mid = buildPiArgs(opts({ prompt: 'ask @user about it' }));
    expect(mid[mid.length - 1]).toBe('ask @user about it');
  });
});

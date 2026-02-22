import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// vi.hoisted runs before vi.mock hoisting — safe to reference in factory
const { mockRelay, mockInstallHosts, mockUninstallHosts, mockVerifyBackends } = vi.hoisted(() => ({
  mockRelay: vi.fn(() => 'mock feedback'),
  mockInstallHosts: vi.fn(() => ['phone-a-friend installer', '- claude: installed']),
  mockUninstallHosts: vi.fn(() => ['phone-a-friend uninstaller', '- claude: removed']),
  mockVerifyBackends: vi.fn(() => [
    { name: 'codex', available: true, hint: '' },
    { name: 'gemini', available: false, hint: 'npm install -g @google/gemini-cli' },
  ]),
}));

vi.mock('../src/relay.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/relay.js')>();
  return {
    ...actual,
    relay: mockRelay,
  };
});

vi.mock('../src/installer.js', () => ({
  installHosts: mockInstallHosts,
  uninstallHosts: mockUninstallHosts,
  verifyBackends: mockVerifyBackends,
  PLUGIN_NAME: 'phone-a-friend',
  MARKETPLACE_NAME: 'phone-a-friend-dev',
  InstallerError: class InstallerError extends Error {},
}));

import { run } from '../src/cli.js';
import { RelayError } from '../src/relay.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phone-a-friend-cli-test-'));
}

function captureOutput(fn: () => unknown): { stdout: string; stderr: string } {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;
  const origConsoleLog = console.log;
  const origConsoleError = console.error;

  process.stdout.write = ((chunk: string) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  console.log = (...args: unknown[]) => {
    stdoutChunks.push(args.map(String).join(' ') + '\n');
  };
  console.error = (...args: unknown[]) => {
    stderrChunks.push(args.map(String).join(' ') + '\n');
  };

  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origConsoleLog;
    console.error = origConsoleError;
  }

  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    mockRelay.mockReset();
    mockRelay.mockReturnValue('mock feedback');
    mockInstallHosts.mockReset();
    mockInstallHosts.mockReturnValue(['phone-a-friend installer', '- claude: installed']);
    mockUninstallHosts.mockReset();
    mockUninstallHosts.mockReturnValue(['phone-a-friend uninstaller', '- claude: removed']);
    mockVerifyBackends.mockReset();
    mockVerifyBackends.mockReturnValue([
      { name: 'codex', available: true, hint: '' },
      { name: 'gemini', available: false, hint: 'npm install -g @google/gemini-cli' },
    ]);
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // --- Version ---

  it('prints version and exits 0', () => {
    const { stdout } = captureOutput(() => {
      const code = run(['--version']);
      expect(code).toBe(0);
    });
    expect(stdout.trim()).toMatch(/^phone-a-friend \d+\.\d+\.\d+/);
  });

  // --- Relay subcommand ---

  it('relay subcommand calls relay with correct args', () => {
    const code = run([
      'relay',
      '--to', 'codex',
      '--repo', tmpDir,
      '--prompt', 'Review latest changes',
      '--timeout', '120',
      '--model', 'o3',
      '--sandbox', 'workspace-write',
      '--include-diff',
    ]);

    expect(code).toBe(0);
    expect(mockRelay).toHaveBeenCalledOnce();
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.backend).toBe('codex');
    expect(opts.repoPath).toBe(tmpDir);
    expect(opts.prompt).toBe('Review latest changes');
    expect(opts.timeoutSeconds).toBe(120);
    expect(opts.model).toBe('o3');
    expect(opts.sandbox).toBe('workspace-write');
    expect(opts.includeDiff).toBe(true);
  });

  it('relay with --context-file passes contextFile', () => {
    const contextPath = path.join(tmpDir, 'ctx.md');
    fs.writeFileSync(contextPath, 'context content');

    run([
      'relay', '--prompt', 'Review', '--repo', tmpDir,
      '--context-file', contextPath,
    ]);

    const opts = mockRelay.mock.calls[0][0];
    expect(opts.contextFile).toBe(contextPath);
    expect(opts.contextText).toBeNull();
  });

  it('relay with --context-text passes contextText', () => {
    run([
      'relay', '--prompt', 'Review', '--repo', tmpDir,
      '--context-text', 'inline context',
    ]);

    const opts = mockRelay.mock.calls[0][0];
    expect(opts.contextText).toBe('inline context');
    expect(opts.contextFile).toBeNull();
  });

  it('relay prints feedback to stdout', () => {
    const { stdout } = captureOutput(() => {
      run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
    });
    expect(stdout.trim()).toBe('mock feedback');
  });

  it('relay defaults to codex backend', () => {
    run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.backend).toBe('codex');
  });

  it('relay defaults to read-only sandbox', () => {
    run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.sandbox).toBe('read-only');
  });

  it('relay dispatches to gemini when --to gemini', () => {
    run(['relay', '--to', 'gemini', '--prompt', 'Review', '--repo', tmpDir]);
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.backend).toBe('gemini');
  });

  // --- Root relay backward compatibility ---

  it('root flags auto-route to relay (backward compat)', () => {
    const code = run([
      '--to', 'codex',
      '--repo', tmpDir,
      '--prompt', 'Review latest changes',
    ]);

    expect(code).toBe(0);
    expect(mockRelay).toHaveBeenCalledOnce();
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.backend).toBe('codex');
    expect(opts.prompt).toBe('Review latest changes');
  });

  // --- Install subcommand ---

  it('install --claude calls installHosts', () => {
    const code = run(['install', '--claude', '--no-claude-cli-sync']);
    expect(code).toBe(0);
    expect(mockInstallHosts).toHaveBeenCalledOnce();
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.target).toBe('claude');
    expect(opts.mode).toBe('symlink');
    expect(opts.force).toBe(false);
    expect(opts.syncClaudeCli).toBe(false);
  });

  it('install with --mode copy passes mode', () => {
    run(['install', '--claude', '--mode', 'copy', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.mode).toBe('copy');
  });

  it('install with --force passes force', () => {
    run(['install', '--claude', '--force', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.force).toBe(true);
  });

  it('install with --repo-root passes repoRoot', () => {
    run(['install', '--claude', '--repo-root', '/custom/path', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.repoRoot).toBe('/custom/path');
  });

  // --- Update subcommand ---

  it('update calls installHosts with force=true', () => {
    const code = run(['update', '--no-claude-cli-sync']);
    expect(code).toBe(0);
    expect(mockInstallHosts).toHaveBeenCalledOnce();
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.force).toBe(true);
    expect(opts.target).toBe('claude');
  });

  it('update with --mode copy passes mode', () => {
    run(['update', '--mode', 'copy', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.mode).toBe('copy');
  });

  // --- Uninstall subcommand ---

  it('uninstall --claude calls uninstallHosts', () => {
    const code = run(['uninstall', '--claude']);
    expect(code).toBe(0);
    expect(mockUninstallHosts).toHaveBeenCalledOnce();
    const opts = mockUninstallHosts.mock.calls[0][0];
    expect(opts.target).toBe('claude');
  });

  // --- Error handling ---

  it('returns 1 and prints to stderr on RelayError', () => {
    mockRelay.mockImplementation(() => {
      throw new RelayError('something went wrong');
    });

    const { stderr } = captureOutput(() => {
      const code = run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
      expect(code).toBe(1);
    });

    expect(stderr).toContain('something went wrong');
  });

  it('returns 1 on installer error', () => {
    mockInstallHosts.mockImplementation(() => {
      throw new Error('install failed');
    });

    const { stderr } = captureOutput(() => {
      const code = run(['install', '--claude', '--no-claude-cli-sync']);
      expect(code).toBe(1);
    });

    expect(stderr).toContain('install failed');
  });

  // --- Commander validation (Codex review fixes) ---

  it('returns non-zero when --prompt is missing from relay', () => {
    const { stderr } = captureOutput(() => {
      const code = run(['relay', '--to', 'codex', '--repo', tmpDir]);
      expect(code).not.toBe(0);
    });
    expect(stderr).toContain('--prompt');
    expect(mockRelay).not.toHaveBeenCalled();
  });

  it('returns non-zero for unknown options', () => {
    const { stderr } = captureOutput(() => {
      const code = run(['relay', '--prompt', 'x', '--bogus-flag', 'y']);
      expect(code).not.toBe(0);
    });
    expect(stderr).toContain('bogus-flag');
    expect(mockRelay).not.toHaveBeenCalled();
  });
});

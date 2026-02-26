import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// vi.hoisted runs before vi.mock hoisting — safe to reference in factory
const {
  mockRelay,
  mockReviewRelay,
  mockInstallHosts,
  mockUninstallHosts,
  mockVerifyBackends,
  mockInstallFromGitHubMarketplace,
  mockSetup,
  mockDoctor,
  mockConfigInit,
  mockConfigPaths,
  mockConfigGet,
  mockConfigSet,
  mockLoadConfig,
  mockSaveConfig,
  mockResolveConfig,
  mockInquirerSelect,
  mockExistsSync,
  mockIsPluginInstalled,
} = vi.hoisted(() => ({
  mockRelay: vi.fn(() => 'mock feedback'),
  mockReviewRelay: vi.fn(() => 'mock review feedback'),
  mockInstallHosts: vi.fn(() => ['phone-a-friend installer', '- claude: installed']),
  mockUninstallHosts: vi.fn(() => ['phone-a-friend uninstaller', '- claude: removed']),
  mockVerifyBackends: vi.fn(() => [
    { name: 'codex', available: true, hint: '' },
    { name: 'gemini', available: false, hint: 'npm install -g @google/gemini-cli' },
  ]),
  mockInstallFromGitHubMarketplace: vi.fn(() => ['marketplace installed']),
  mockSetup: vi.fn(),
  mockDoctor: vi.fn(() => Promise.resolve({ exitCode: 0, output: 'Health Check' })),
  mockConfigInit: vi.fn(),
  mockConfigPaths: vi.fn(() => ({ user: '/home/test/.config/phone-a-friend/config.toml', repo: null })),
  mockConfigGet: vi.fn(),
  mockConfigSet: vi.fn(),
  mockLoadConfig: vi.fn(() => ({
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
  })),
  mockSaveConfig: vi.fn(),
  mockResolveConfig: vi.fn((cliOpts: Record<string, string | undefined>) => ({
    backend: cliOpts.to ?? 'codex',
    sandbox: cliOpts.sandbox ?? 'read-only',
    timeout: cliOpts.timeout ? Number(cliOpts.timeout) : 600,
    includeDiff: cliOpts.includeDiff === 'true',
    model: cliOpts.model,
  })),
  mockInquirerSelect: vi.fn(),
  mockExistsSync: vi.fn(() => true),
  mockIsPluginInstalled: vi.fn(() => true),
}));

vi.mock('../src/relay.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/relay.js')>();
  return {
    ...actual,
    relay: mockRelay,
    reviewRelay: mockReviewRelay,
  };
});

vi.mock('../src/installer.js', () => ({
  installHosts: mockInstallHosts,
  uninstallHosts: mockUninstallHosts,
  verifyBackends: mockVerifyBackends,
  isPluginInstalled: mockIsPluginInstalled,
  installFromGitHubMarketplace: mockInstallFromGitHubMarketplace,
  PLUGIN_NAME: 'phone-a-friend',
  MARKETPLACE_NAME: 'phone-a-friend-marketplace',
  GITHUB_REPO: 'freibergergarcia/phone-a-friend',
  InstallerError: class InstallerError extends Error {},
}));

vi.mock('../src/setup.js', () => ({
  setup: mockSetup,
}));

vi.mock('../src/doctor.js', () => ({
  doctor: mockDoctor,
}));

vi.mock('@inquirer/prompts', () => ({
  select: mockInquirerSelect,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

vi.mock('../src/config.js', () => ({
  configInit: mockConfigInit,
  configPaths: mockConfigPaths,
  configGet: mockConfigGet,
  configSet: mockConfigSet,
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  resolveConfig: mockResolveConfig,
  DEFAULT_CONFIG: {
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
  },
}));

import { run } from '../src/cli.js';
import { RelayError } from '../src/relay.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phone-a-friend-cli-test-'));
}

function captureOutput(fn: () => unknown): { stdout: string; stderr: string; result: unknown } {
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

  let result: unknown;
  try {
    result = fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origConsoleLog;
    console.error = origConsoleError;
  }

  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    result,
  };
}

async function captureOutputAsync(fn: () => Promise<unknown>): Promise<{ stdout: string; stderr: string; result: unknown }> {
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

  let result: unknown;
  try {
    result = await fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origConsoleLog;
    console.error = origConsoleError;
  }

  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    result,
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
    mockReviewRelay.mockReset();
    mockReviewRelay.mockReturnValue('mock review feedback');
    mockInstallHosts.mockReset();
    mockInstallHosts.mockReturnValue(['phone-a-friend installer', '- claude: installed']);
    mockUninstallHosts.mockReset();
    mockUninstallHosts.mockReturnValue(['phone-a-friend uninstaller', '- claude: removed']);
    mockVerifyBackends.mockReset();
    mockVerifyBackends.mockReturnValue([
      { name: 'codex', available: true, hint: '' },
      { name: 'gemini', available: false, hint: 'npm install -g @google/gemini-cli' },
    ]);
    mockInstallFromGitHubMarketplace.mockReset();
    mockInstallFromGitHubMarketplace.mockReturnValue(['marketplace installed']);
    mockSetup.mockReset();
    mockSetup.mockResolvedValue(undefined);
    mockDoctor.mockReset();
    mockDoctor.mockResolvedValue({ exitCode: 0, output: 'Health Check output' });
    mockConfigInit.mockReset();
    mockConfigPaths.mockReset();
    mockConfigPaths.mockReturnValue({ user: '/home/test/.config/phone-a-friend/config.toml', repo: null });
    mockConfigGet.mockReset();
    mockConfigSet.mockReset();
    mockLoadConfig.mockReset();
    mockLoadConfig.mockReturnValue({
      defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    });
    mockInquirerSelect.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(true);
    mockIsPluginInstalled.mockReset();
    mockIsPluginInstalled.mockReturnValue(true);
    mockResolveConfig.mockReset();
    mockResolveConfig.mockImplementation((cliOpts: Record<string, string | undefined>) => ({
      backend: cliOpts.to ?? 'codex',
      sandbox: cliOpts.sandbox ?? 'read-only',
      timeout: cliOpts.timeout ? Number(cliOpts.timeout) : 600,
      includeDiff: cliOpts.includeDiff === 'true',
      model: cliOpts.model,
    }));
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // --- Version ---

  it('prints version and exits 0', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['--version']);
      expect(code).toBe(0);
    });
    expect(stdout.trim()).toMatch(/^phone-a-friend \d+\.\d+\.\d+/);
  });

  it('-v prints version (lowercase alias)', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['-v']);
      expect(code).toBe(0);
    });
    expect(stdout.trim()).toMatch(/^phone-a-friend \d+\.\d+\.\d+/);
  });

  // --- Relay subcommand ---

  it('relay subcommand calls relay with correct args', async () => {
    const code = await run([
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

  it('relay with --context-file passes contextFile', async () => {
    const contextPath = path.join(tmpDir, 'ctx.md');
    fs.writeFileSync(contextPath, 'context content');

    await run([
      'relay', '--prompt', 'Review', '--repo', tmpDir,
      '--context-file', contextPath,
    ]);

    const opts = mockRelay.mock.calls[0][0];
    expect(opts.contextFile).toBe(contextPath);
    expect(opts.contextText).toBeNull();
  });

  it('relay with --context-text passes contextText', async () => {
    await run([
      'relay', '--prompt', 'Review', '--repo', tmpDir,
      '--context-text', 'inline context',
    ]);

    const opts = mockRelay.mock.calls[0][0];
    expect(opts.contextText).toBe('inline context');
    expect(opts.contextFile).toBeNull();
  });

  it('relay prints feedback to stdout', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      await run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
    });
    expect(stdout.trim()).toBe('mock feedback');
  });

  it('relay defaults to codex backend', async () => {
    await run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.backend).toBe('codex');
  });

  it('relay defaults to read-only sandbox', async () => {
    await run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.sandbox).toBe('read-only');
  });

  it('relay dispatches to gemini when --to gemini', async () => {
    await run(['relay', '--to', 'gemini', '--prompt', 'Review', '--repo', tmpDir]);
    const opts = mockRelay.mock.calls[0][0];
    expect(opts.backend).toBe('gemini');
  });

  // --- Review mode ---

  it('--review flag routes to reviewRelay()', async () => {
    const code = await run([
      'relay', '--review', '--prompt', 'Review changes', '--repo', tmpDir,
    ]);

    expect(code).toBe(0);
    expect(mockReviewRelay).toHaveBeenCalledOnce();
    expect(mockRelay).not.toHaveBeenCalled();
    const opts = mockReviewRelay.mock.calls[0][0];
    expect(opts.prompt).toBe('Review changes');
    expect(opts.repoPath).toBe(tmpDir);
  });

  it('--base main passes base to reviewRelay()', async () => {
    const code = await run([
      'relay', '--review', '--base', 'main', '--prompt', 'Review', '--repo', tmpDir,
    ]);

    expect(code).toBe(0);
    expect(mockReviewRelay).toHaveBeenCalledOnce();
    const opts = mockReviewRelay.mock.calls[0][0];
    expect(opts.base).toBe('main');
  });

  it('--base without --review implies review mode', async () => {
    const code = await run([
      'relay', '--base', 'develop', '--prompt', 'Review', '--repo', tmpDir,
    ]);

    expect(code).toBe(0);
    expect(mockReviewRelay).toHaveBeenCalledOnce();
    expect(mockRelay).not.toHaveBeenCalled();
    const opts = mockReviewRelay.mock.calls[0][0];
    expect(opts.base).toBe('develop');
  });

  it('--review passes backend and model through', async () => {
    await run([
      'relay', '--review', '--to', 'gemini', '--model', 'gemini-2.5-flash',
      '--prompt', 'Review', '--repo', tmpDir,
    ]);

    expect(mockReviewRelay).toHaveBeenCalledOnce();
    const opts = mockReviewRelay.mock.calls[0][0];
    expect(opts.backend).toBe('gemini');
    expect(opts.model).toBe('gemini-2.5-flash');
  });

  it('--review prints feedback to stdout', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      await run(['relay', '--review', '--prompt', 'Review', '--repo', tmpDir]);
    });
    expect(stdout.trim()).toBe('mock review feedback');
  });

  // --- Root relay backward compatibility ---

  it('root flags auto-route to relay (backward compat)', async () => {
    const code = await run([
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

  // --- Install subcommand (backward compat) ---

  it('install --claude calls installHosts (backward compat)', async () => {
    const code = await run(['install', '--claude', '--no-claude-cli-sync']);
    expect(code).toBe(0);
    expect(mockInstallHosts).toHaveBeenCalledOnce();
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.target).toBe('claude');
    expect(opts.mode).toBe('symlink');
    expect(opts.force).toBe(false);
    expect(opts.syncClaudeCli).toBe(false);
  });

  it('install with --mode copy passes mode', async () => {
    await run(['install', '--claude', '--mode', 'copy', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.mode).toBe('copy');
  });

  it('install with --force passes force', async () => {
    await run(['install', '--claude', '--force', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.force).toBe(true);
  });

  it('install with --repo-root passes repoRoot', async () => {
    await run(['install', '--claude', '--repo-root', '/custom/path', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.repoRoot).toBe('/custom/path');
  });

  // --- Update subcommand (backward compat) ---

  it('update calls installHosts with force=true', async () => {
    const code = await run(['update', '--no-claude-cli-sync']);
    expect(code).toBe(0);
    expect(mockInstallHosts).toHaveBeenCalledOnce();
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.force).toBe(true);
    expect(opts.target).toBe('claude');
  });

  it('update with --mode copy passes mode', async () => {
    await run(['update', '--mode', 'copy', '--no-claude-cli-sync']);
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.mode).toBe('copy');
  });

  // --- Uninstall subcommand (backward compat) ---

  it('uninstall --claude calls uninstallHosts', async () => {
    const code = await run(['uninstall', '--claude']);
    expect(code).toBe(0);
    expect(mockUninstallHosts).toHaveBeenCalledOnce();
    const opts = mockUninstallHosts.mock.calls[0][0];
    expect(opts.target).toBe('claude');
  });

  // --- Plugin subcommand (new primary namespace) ---

  it('plugin install --claude works', async () => {
    const code = await run(['plugin', 'install', '--claude', '--no-claude-cli-sync']);
    expect(code).toBe(0);
    expect(mockInstallHosts).toHaveBeenCalledOnce();
  });

  it('plugin update --claude works', async () => {
    const code = await run(['plugin', 'update', '--no-claude-cli-sync']);
    expect(code).toBe(0);
    expect(mockInstallHosts).toHaveBeenCalledOnce();
    const opts = mockInstallHosts.mock.calls[0][0];
    expect(opts.force).toBe(true);
  });

  it('plugin uninstall --claude works', async () => {
    const code = await run(['plugin', 'uninstall', '--claude']);
    expect(code).toBe(0);
    expect(mockUninstallHosts).toHaveBeenCalledOnce();
  });

  // --- Plugin install --github ---

  it('plugin install --github calls installFromGitHubMarketplace', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['plugin', 'install', '--github']);
      expect(code).toBe(0);
    });
    expect(mockInstallFromGitHubMarketplace).toHaveBeenCalledOnce();
    expect(mockInstallHosts).not.toHaveBeenCalled();
    expect(stdout).toContain('GitHub marketplace');
  });

  it('plugin install --github rejects --mode copy', async () => {
    const { stderr } = await captureOutputAsync(async () => {
      await run(['plugin', 'install', '--github', '--mode', 'copy']);
    });
    expect(stderr).toContain('--mode is not compatible with --github');
    expect(mockInstallFromGitHubMarketplace).not.toHaveBeenCalled();
  });

  it('plugin install --github rejects --repo-root', async () => {
    const { stderr } = await captureOutputAsync(async () => {
      await run(['plugin', 'install', '--github', '--repo-root', '/foo']);
    });
    expect(stderr).toContain('--repo-root is not compatible with --github');
    expect(mockInstallFromGitHubMarketplace).not.toHaveBeenCalled();
  });

  it('install --github works via backward-compat alias', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['install', '--github']);
      expect(code).toBe(0);
    });
    expect(mockInstallFromGitHubMarketplace).toHaveBeenCalledOnce();
    expect(stdout).toContain('GitHub marketplace');
  });

  // --- Setup subcommand ---

  it('setup subcommand calls setup()', async () => {
    const code = await run(['setup']);
    expect(code).toBe(0);
    expect(mockSetup).toHaveBeenCalledOnce();
  });

  // --- Doctor subcommand ---

  it('doctor subcommand calls doctor()', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['doctor']);
      expect(code).toBe(0);
    });
    expect(mockDoctor).toHaveBeenCalledOnce();
    expect(stdout).toContain('Health Check');
  });

  it('doctor --json passes json flag', async () => {
    mockDoctor.mockResolvedValue({ exitCode: 0, output: '{"status":"ok"}' });
    await run(['doctor', '--json']);
    expect(mockDoctor).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
  });

  it('doctor returns exit code from doctor result', async () => {
    mockDoctor.mockResolvedValue({ exitCode: 2, output: 'no backends' });
    const code = await run(['doctor']);
    expect(code).toBe(2);
  });

  // --- Config subcommands ---

  it('config init creates default config', async () => {
    const code = await run(['config', 'init']);
    expect(code).toBe(0);
    expect(mockConfigInit).toHaveBeenCalled();
  });

  it('config show displays config', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['config', 'show']);
      expect(code).toBe(0);
    });
    expect(stdout).toBeTruthy();
  });

  it('config paths shows config file paths', async () => {
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['config', 'paths']);
      expect(code).toBe(0);
    });
    expect(stdout).toContain('config.toml');
  });

  it('config set key value sets a config value', async () => {
    const code = await run(['config', 'set', 'defaults.backend', 'gemini']);
    expect(code).toBe(0);
    expect(mockConfigSet).toHaveBeenCalledWith(
      'defaults.backend',
      'gemini',
      expect.any(String),
    );
  });

  it('config get key gets a config value', async () => {
    mockConfigGet.mockReturnValue('codex');
    const { stdout } = await captureOutputAsync(async () => {
      const code = await run(['config', 'get', 'defaults.backend']);
      expect(code).toBe(0);
    });
    expect(mockConfigGet).toHaveBeenCalled();
  });

  // --- Error handling ---

  it('returns 1 and prints to stderr on RelayError', async () => {
    mockRelay.mockImplementation(() => {
      throw new RelayError('something went wrong');
    });

    const { stderr } = await captureOutputAsync(async () => {
      const code = await run(['relay', '--prompt', 'Review', '--repo', tmpDir]);
      expect(code).toBe(1);
    });

    expect(stderr).toContain('something went wrong');
  });

  it('returns 1 on installer error', async () => {
    mockInstallHosts.mockImplementation(() => {
      throw new Error('install failed');
    });

    const { stderr } = await captureOutputAsync(async () => {
      const code = await run(['install', '--claude', '--no-claude-cli-sync']);
      expect(code).toBe(1);
    });

    expect(stderr).toContain('install failed');
  });

  // --- Commander validation ---

  it('returns non-zero when --prompt is missing from relay', async () => {
    const { stderr } = await captureOutputAsync(async () => {
      const code = await run(['relay', '--to', 'codex', '--repo', tmpDir]);
      expect(code).not.toBe(0);
    });
    expect(stderr).toContain('--prompt');
    expect(mockRelay).not.toHaveBeenCalled();
  });

  it('returns non-zero for unknown options', async () => {
    const { stderr } = await captureOutputAsync(async () => {
      const code = await run(['relay', '--prompt', 'x', '--bogus-flag', 'y']);
      expect(code).not.toBe(0);
    });
    expect(stderr).toContain('bogus-flag');
    expect(mockRelay).not.toHaveBeenCalled();
  });

  // --- First-run TTY gate ---

  describe('first-run TTY gate', () => {
    let origIsTTY: boolean | undefined;

    beforeEach(() => {
      origIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      // Config file does not exist — existsSync returns false for the config path
      mockExistsSync.mockReturnValue(false);
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
      // Restore default: existsSync returns true (config exists)
      mockExistsSync.mockReturnValue(true);
    });

    it('shows first-run menu and runs setup when chosen', async () => {
      mockInquirerSelect.mockResolvedValue('setup');
      const { stdout } = await captureOutputAsync(async () => {
        const code = await run([]);
        expect(code).toBe(0);
      });
      expect(stdout).toContain('Welcome');
      expect(mockSetup).toHaveBeenCalledOnce();
    });

    it('prints quick start examples when chosen', async () => {
      mockInquirerSelect.mockResolvedValue('quickstart');
      const { stdout } = await captureOutputAsync(async () => {
        const code = await run([]);
        expect(code).toBe(0);
      });
      expect(stdout).toContain('Quick start');
      expect(stdout).toContain('phone-a-friend --to codex');
      expect(stdout).toContain('agentic run');
    });

    it('exits cleanly when exit is chosen', async () => {
      mockInquirerSelect.mockResolvedValue('exit');
      const code = await run([]);
      expect(code).toBe(0);
    });
  });

  describe('plugin-not-installed TTY prompt', () => {
    let origIsTTY: boolean | undefined;

    beforeEach(() => {
      origIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      // Config exists but plugin is not installed
      mockExistsSync.mockReturnValue(true);
      mockIsPluginInstalled.mockReturnValue(false);
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
      mockExistsSync.mockReturnValue(true);
      mockIsPluginInstalled.mockReturnValue(true);
    });

    it('shows plugin-not-installed prompt and runs setup when chosen', async () => {
      mockInquirerSelect.mockResolvedValue('setup');
      const { stdout } = await captureOutputAsync(async () => {
        const code = await run([]);
        expect(code).toBe(0);
      });
      expect(stdout).toContain('Claude plugin is not installed');
      expect(mockSetup).toHaveBeenCalledOnce();
    });

    it('installs plugin when install is chosen', async () => {
      mockInquirerSelect.mockResolvedValue('install');
      const { stdout } = await captureOutputAsync(async () => {
        const code = await run([]);
        expect(code).toBe(0);
      });
      expect(mockInstallHosts).toHaveBeenCalledOnce();
      const opts = mockInstallHosts.mock.calls[0][0];
      expect(opts.force).toBe(true);
    });

    it('exits cleanly when exit is chosen', async () => {
      mockInquirerSelect.mockResolvedValue('exit');
      const code = await run([]);
      expect(code).toBe(0);
      expect(mockSetup).not.toHaveBeenCalled();
      expect(mockInstallHosts).not.toHaveBeenCalled();
    });
  });
});

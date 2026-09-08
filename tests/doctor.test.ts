import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DetectionReport } from '../src/detection.js';
import type { ExecutableInfo, PafIdentity } from '../src/diagnostics.js';

// Mock detection and config modules
const { mockDetectAll, mockLoadConfig, mockConfigPaths } = vi.hoisted(() => ({
  mockDetectAll: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockConfigPaths: vi.fn(),
}));

const { mockInspectExecutables, mockAttachModelAndCapabilities, mockInspectPafIdentity } = vi.hoisted(() => ({
  mockInspectExecutables: vi.fn(),
  mockAttachModelAndCapabilities: vi.fn(),
  mockInspectPafIdentity: vi.fn(),
}));

const { mockIsPluginInstalled, mockIsOpenCodeInstalled, mockIsCodexInstalled } = vi.hoisted(() => ({
  mockIsPluginInstalled: vi.fn(),
  mockIsOpenCodeInstalled: vi.fn(),
  mockIsCodexInstalled: vi.fn(),
}));

vi.mock('../src/detection.js', () => ({
  detectAll: mockDetectAll,
  decorateOpenCodeModels: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  loadConfig: mockLoadConfig,
  configPaths: mockConfigPaths,
  DEFAULT_CONFIG: {
    defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
  },
}));

// Executable diagnostics spawn real `--version` probes; keep doctor tests
// hermetic by mocking the module and injecting fixtures per test.
vi.mock('../src/diagnostics.js', () => ({
  inspectExecutables: mockInspectExecutables,
  attachModelAndCapabilities: mockAttachModelAndCapabilities,
  inspectPafIdentity: mockInspectPafIdentity,
}));

vi.mock('../src/installer.js', () => ({
  isPluginInstalled: mockIsPluginInstalled,
  isOpenCodeInstalled: mockIsOpenCodeInstalled,
  isCodexInstalled: mockIsCodexInstalled,
}));

// Helper: build a detection report
function makeReport(overrides?: Partial<DetectionReport>): DetectionReport {
  return {
    cli: [
      { name: 'antigravity', category: 'cli', available: false, detail: 'agy not found in PATH', installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', optional: true },
      { name: 'codex', category: 'cli', available: true, detail: 'OpenAI Codex CLI (found in PATH)', installHint: 'npm install -g @openai/codex' },
      { name: 'gemini', category: 'cli', available: false, detail: 'not found in PATH', installHint: 'npm install -g @google/gemini-cli' },
    ],
    local: [
      { name: 'ollama', category: 'local', available: true, detail: 'http://localhost:11434 (2 models)', installHint: '', models: ['qwen3:latest', 'llama3.2:latest'] },
    ],
    host: [
      { name: 'claude', category: 'host', available: true, detail: 'Claude Code CLI (found in PATH)', installHint: 'npm install -g @anthropic-ai/claude-code' },
    ],
    environment: {
      tmux: { active: false, installed: true },
      agentTeams: { enabled: false },
    },
    ...overrides,
  };
}

type Candidate = ExecutableInfo['candidates'][number];

function candidate(path: string, version: string | null, versionStatus: Candidate['versionStatus'] = 'ok', versionError?: string): Candidate {
  return { path, resolvedPath: path, version, versionStatus, ...(versionError ? { versionError } : {}) };
}

function executableInfo(command: string, candidates: Candidate[], guidance: string[] = []): ExecutableInfo {
  const versions = new Set(candidates.map(c => c.version).filter(Boolean));
  return {
    command,
    selected: candidates[0] ?? null,
    candidates,
    shadowed: candidates.length > 1,
    versionMismatch: versions.size > 1,
    guidance,
  };
}

function pafIdentity(overrides?: Partial<PafIdentity>): PafIdentity {
  return {
    version: '4.4.0',
    packageRoot: '/checkout/phone-a-friend',
    entry: '/checkout/phone-a-friend/dist/index.js',
    pathCandidates: [],
    runningDiffersFromPath: false,
    guidance: [],
    ...overrides,
  };
}

describe('doctor', () => {
  let doctor: typeof import('../src/doctor.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConfigPaths.mockReturnValue({
      user: '/home/test/.config/phone-a-friend/config.toml',
      repo: null,
    });
    mockLoadConfig.mockReturnValue({
      defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false },
    });
    mockIsPluginInstalled.mockReturnValue(true);
    mockIsOpenCodeInstalled.mockReturnValue(false);
    mockIsCodexInstalled.mockReturnValue(false);
    mockInspectExecutables.mockResolvedValue(undefined);
    mockAttachModelAndCapabilities.mockReturnValue(undefined);
    mockInspectPafIdentity.mockReturnValue(pafIdentity());
    doctor = await import('../src/doctor.js');
  });

  describe('human-readable output', () => {
    it('returns health check output with system info', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('Health Check');
      expect(result.output).toContain('Node.js');
    });

    it('shows CLI backends with availability marks', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      // Available backend gets checkmark
      expect(result.output).toMatch(/codex/);
      // Unavailable backend gets X
      expect(result.output).toMatch(/gemini/);
    });

    it('shows local backends (Ollama)', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('ollama');
      expect(result.output).toContain('2 models');
    });

    it('shows host integrations separately', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('Host');
      expect(result.output).toContain('claude');
    });

    it('shows host install status separately', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('Host Install Status');
      expect(result.output).toContain('Claude plugin');
      expect(result.output).toContain('OpenCode commands/skills');
    });

    it('shows install hints for missing backends', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('npm install -g @google/gemini-cli');
    });

    it('shows default backend from config', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      expect(result.output).toContain('Default');
      expect(result.output).toContain('codex');
    });

    it('shows relay backend summary count', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();

      // codex + ollama = 2 available out of 3 countable relay backends.
      // Missing optional Antigravity is shown but excluded from the denominator.
      expect(result.output).toContain('2');
    });
  });

  describe('exit codes', () => {
    it('returns 0 when all relay backends are healthy', async () => {
      const report = makeReport({
        cli: [
          { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'gemini', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'antigravity', category: 'cli', available: false, detail: 'agy not found', installHint: 'install antigravity', optional: true },
        ],
        local: [
          { name: 'ollama', category: 'local', available: true, detail: 'running', installHint: '' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();
      expect(result.exitCode).toBe(0);
    });

    it('returns 1 when some implemented backends have issues', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();
      // gemini unavailable -> exit 1
      expect(result.exitCode).toBe(1);
    });

    it('returns 2 when no relay backends are available', async () => {
      const report = makeReport({
        cli: [
          { name: 'codex', category: 'cli', available: false, detail: 'not found', installHint: 'install codex' },
          { name: 'gemini', category: 'cli', available: false, detail: 'not found', installHint: 'install gemini' },
          { name: 'antigravity', category: 'cli', available: false, detail: 'agy not found', installHint: 'install antigravity', optional: true },
        ],
        local: [
          { name: 'ollama', category: 'local', available: false, detail: 'not installed', installHint: 'install ollama' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();
      expect(result.exitCode).toBe(2);
    });

    it('does not penalize Claude-only installs missing the optional OpenCode CLI', async () => {
      // A Claude-only user with codex+gemini+ollama healthy but no OpenCode
      // CLI should still see exit code 0. The opencode entry is `optional`
      // when absent, so it must not count toward the denominator.
      // (Without this, adding OpenCode to CLI_BACKENDS would silently
      // poison every existing Claude user's `phone-a-friend doctor` check.)
      const report = makeReport({
        cli: [
          { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'gemini', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'antigravity', category: 'cli', available: false, detail: 'agy not found', installHint: 'install antigravity', optional: true },
          { name: 'opencode', category: 'cli', available: false, detail: 'not found', installHint: 'install opencode', optional: true },
        ],
        local: [
          { name: 'ollama', category: 'local', available: true, detail: 'running', installHint: '' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('3 of 3 relay backends ready');
    });

    it('counts optional Antigravity toward the denominator when present', async () => {
      const report = makeReport({
        cli: [
          { name: 'antigravity', category: 'cli', available: true, detail: 'agy found', installHint: '', optional: true },
          { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'gemini', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'opencode', category: 'cli', available: false, detail: 'not found', installHint: '', optional: true },
        ],
        local: [
          { name: 'ollama', category: 'local', available: true, detail: 'running', installHint: '' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('4 of 4 relay backends ready');
    });

    it('counts optional OpenCode toward the denominator when present', async () => {
      // If the user installs OpenCode, it joins the count. Optional-and-
      // available means "the user opted in; treat it like any other backend."
      const report = makeReport({
        cli: [
          { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'gemini', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'antigravity', category: 'cli', available: false, detail: 'agy not found', installHint: '', optional: true },
          { name: 'opencode', category: 'cli', available: true, detail: 'found', installHint: '', optional: true },
        ],
        local: [
          { name: 'ollama', category: 'local', available: true, detail: 'running', installHint: '' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('4 of 4 relay backends ready');
    });

    it('JSON summary stays in lockstep with exit code', async () => {
      // Codex's specific concern: the human-readable summary used to count
      // all backends while exit code filtered planned. JSON had the same
      // bug. This test pins that all three (human, JSON, exit code) apply
      // the same `countableBackends` filter.
      const report = makeReport({
        cli: [
          { name: 'codex', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'gemini', category: 'cli', available: true, detail: 'found', installHint: '' },
          { name: 'antigravity', category: 'cli', available: false, detail: 'agy not found', installHint: '', optional: true },
          { name: 'opencode', category: 'cli', available: false, detail: 'not found', installHint: '', optional: true },
        ],
        local: [
          { name: 'ollama', category: 'local', available: true, detail: 'running', installHint: '' },
        ],
      });
      mockDetectAll.mockResolvedValue(report);
      const json = JSON.parse((await doctor.doctor({ json: true })).output);
      expect(json.summary).toEqual({ available: 3, total: 3 });
      expect(json.exitCode).toBe(0);
    });
  });

  describe('JSON output', () => {
    it('returns structured JSON when json flag is set', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor({ json: true });

      const parsed = JSON.parse(result.output);
      expect(parsed.system).toBeDefined();
      expect(parsed.backends).toBeDefined();
      expect(parsed.backends.cli).toBeDefined();
      expect(parsed.backends.local).toBeDefined();
      expect(parsed.host).toBeDefined();
      expect(parsed.hostInstallations).toEqual({ claude: true, opencode: false, codex: false });
      expect(parsed.default).toBe('codex');
      expect(parsed.exitCode).toBeDefined();
    });

    it('JSON includes relay backend count', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor({ json: true });
      const parsed = JSON.parse(result.output);

      expect(parsed.summary.available).toBe(2);
      expect(parsed.summary.total).toBe(3);
    });
  });

  describe('executable diagnostics', () => {
    const NVM_CODEX = '/home/test/.nvm/versions/node/v24/bin/codex';
    const BREW_CODEX = '/usr/local/bin/codex';

    function reportWithCodexMismatch(): DetectionReport {
      const report = makeReport();
      const info = executableInfo('codex', [
        candidate(NVM_CODEX, '0.153.4'),
        candidate(BREW_CODEX, '0.146.0'),
      ], [
        `PaF subprocesses run the first PATH match for "codex": ${NVM_CODEX} (0.153.4). Also on PATH: ${BREW_CODEX} (0.146.0).`,
        'These installs report different versions. If a relay fails on a model or flag that a newer codex supports, put that install\'s directory earlier in PATH for the PaF process, or remove the duplicates.',
      ]);
      report.cli.find(b => b.name === 'codex')!.executable = info;
      report.host.push({ name: 'codex', category: 'host', available: true, detail: 'found', installHint: '', executable: info });
      return report;
    }

    it('shows the executable PaF will spawn and the other PATH candidates', async () => {
      mockDetectAll.mockResolvedValue(reportWithCodexMismatch());
      const result = await doctor.doctor();

      expect(mockInspectExecutables).toHaveBeenCalledOnce();
      expect(result.output).toContain(`exec: ${NVM_CODEX} (0.153.4)`);
      expect(result.output).toContain(`also on PATH: ${BREW_CODEX} (0.146.0)`);
      expect(result.output).toContain('[versions differ]');
    });

    it('surfaces version-mismatch guidance as an advisory', async () => {
      mockDetectAll.mockResolvedValue(reportWithCodexMismatch());
      const result = await doctor.doctor();

      expect(result.output).toContain('Advisories');
      expect(result.output).toContain('first PATH match for "codex"');
      expect(result.output).toContain('earlier in PATH');
    });

    it('does not repeat the executable block for a host entry already detailed as a relay backend', async () => {
      mockDetectAll.mockResolvedValue(reportWithCodexMismatch());
      const result = await doctor.doctor();

      const execLines = result.output.split('\n').filter(l => l.includes(`exec: ${NVM_CODEX}`));
      expect(execLines).toHaveLength(1);
      expect(result.output).toContain('exec: same as relay backend "codex" above');
    });

    it('stays quiet for duplicates that report the same version', async () => {
      const report = makeReport();
      report.cli.find(b => b.name === 'codex')!.executable = executableInfo('codex', [
        candidate(NVM_CODEX, '0.153.4'),
        candidate(BREW_CODEX, '0.153.4'),
      ], ['All probed candidates report the same version; no action needed unless one is stale.']);
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();

      expect(result.output).toContain('also on PATH');
      expect(result.output).not.toContain('[versions differ]');
      expect(result.output).not.toContain('no action needed');
    });

    it('reports a failed or timed-out version probe honestly and as an advisory', async () => {
      const report = makeReport();
      report.cli.find(b => b.name === 'codex')!.executable = executableInfo('codex', [
        candidate(NVM_CODEX, null, 'timeout', '--version did not finish within 5s'),
      ], [`Could not determine the version of ${NVM_CODEX}: --version did not finish within 5s. Run "${NVM_CODEX} --version" manually to inspect it.`]);
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();

      expect(result.output).toContain(`exec: ${NVM_CODEX} (version timeout)`);
      expect(result.output).toContain('Could not determine the version');
      // Diagnostics never change the exit code: gemini is still the only gap.
      expect(result.exitCode).toBe(1);
    });

    it('renders Claude host diagnostics even though Claude is categorized as a host', async () => {
      const report = makeReport();
      report.host.find(b => b.name === 'claude')!.executable = executableInfo('claude', [
        candidate('/home/test/.local/bin/claude', '2.1.263'),
      ]);
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();

      expect(result.output).toContain('exec: /home/test/.local/bin/claude (2.1.263)');
    });

    it('includes the configured Claude model in human output', async () => {
      const report = makeReport();
      const claude = report.host.find(b => b.name === 'claude')!;
      claude.executable = executableInfo('claude', [candidate('/test/claude', '2.1.263')]);
      claude.model = { requested: 'configured-claude', requestedSource: 'paf-config', reported: null, reportedNote: 'Unknown' };
      mockDetectAll.mockResolvedValue(report);
      expect((await doctor.doctor()).output).toContain('requested=configured-claude (from PaF config), reported=unknown');
    });

    it.each([0, 1])('keeps private version-probe text out of human and JSON output (exit %s)', async (exit) => {
      const dir = mkdtempSync(join(tmpdir(), 'paf-doctor-private-'));
      try {
        writeFileSync(join(dir, 'codex'), `#!/bin/sh\necho 'SYNTHETIC_PRIVATE_TOKEN=marker' >&2\nexit ${exit}\n`, { mode: 0o755 });
        const real = await vi.importActual<typeof import('../src/diagnostics.js')>('../src/diagnostics.js');
        const report = makeReport();
        report.cli.find(b => b.name === 'codex')!.executable = await real.inspectExecutable('codex', { env: { PATH: dir } });
        mockDetectAll.mockResolvedValue(report);
        for (const json of [false, true]) {
          const result = await doctor.doctor({ json });
          expect(result.output).not.toContain('SYNTHETIC_PRIVATE_TOKEN');
          expect(result.output).toContain(exit ? 'exit code 1' : 'unrecognized version output');
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('distinguishes the requested model from the backend-reported model', async () => {
      const report = makeReport();
      const codex = report.cli.find(b => b.name === 'codex')!;
      codex.executable = executableInfo('codex', [candidate(NVM_CODEX, '0.153.4')]);
      codex.model = {
        requested: 'gpt-6-astra',
        requestedSource: 'paf-config',
        reported: null,
        reportedNote: 'Unknown: doctor does not run backends.',
      };
      const ollama = report.local[0];
      ollama.executable = executableInfo('ollama', [candidate('/usr/local/bin/ollama', '0.30.8')]);
      ollama.model = { requested: null, requestedSource: 'backend-default', reported: null, reportedNote: 'Unknown' };
      mockDetectAll.mockResolvedValue(report);
      const result = await doctor.doctor();

      expect(result.output).toContain('model: requested=gpt-6-astra (from PaF config), reported=unknown');
      expect(result.output).toContain('model: requested=backend default, reported=unknown');
      expect(result.output).toContain('local client (relay uses HTTP):');
    });

    it('shows the running PaF build and flags a different PATH install', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      mockInspectPafIdentity.mockReturnValue(pafIdentity({
        pathCandidates: [
          candidate('/home/test/.nvm/versions/node/v24/bin/phone-a-friend', '4.0.0'),
          candidate('/usr/local/bin/phone-a-friend', '2.7.1'),
        ],
        runningDiffersFromPath: true,
        guidance: ['This doctor run is PaF 4.4.0 at /checkout/phone-a-friend, but "phone-a-friend" on PATH resolves to /home/test/.nvm/versions/node/v24/bin/phone-a-friend (4.0.0).'],
      }));
      const result = await doctor.doctor();

      expect(result.output).toContain('phone-a-friend 4.4.0 (running from /checkout/phone-a-friend)');
      expect(result.output).toContain('on PATH: /home/test/.nvm/versions/node/v24/bin/phone-a-friend (4.0.0) [differs from this run]');
      expect(result.output).toContain('also on PATH: /usr/local/bin/phone-a-friend (2.7.1)');
      expect(result.output).toContain('on PATH resolves to');
    });

    it('says so when phone-a-friend is not on PATH', async () => {
      mockDetectAll.mockResolvedValue(makeReport());
      const result = await doctor.doctor();
      expect(result.output).toContain('on PATH: phone-a-friend not found');
    });

    it('JSON output carries the same facts as additive fields', async () => {
      const report = reportWithCodexMismatch();
      const codex = report.cli.find(b => b.name === 'codex')!;
      codex.model = { requested: null, requestedSource: 'backend-default', reported: null, reportedNote: 'Unknown' };
      codex.capabilities = {
        declared: { resumeStrategy: 'native-session', requiresClientSessionId: false, localFileAccess: true },
        verification: 'declared-only',
        verificationNote: 'Declared by the PaF adapter in source; not verified against the installed CLI.',
      };
      mockDetectAll.mockResolvedValue(report);
      mockInspectPafIdentity.mockReturnValue(pafIdentity({
        pathCandidates: [candidate('/usr/local/bin/phone-a-friend', '4.0.0')],
        runningDiffersFromPath: true,
        guidance: ['differs'],
      }));
      const parsed = JSON.parse((await doctor.doctor({ json: true })).output);

      expect((await doctor.doctor()).output).toContain('adapter capabilities (not CLI-verified): resume=native-session');

      // Existing contract untouched.
      expect(parsed.system.version).toBeDefined();
      expect(parsed.summary).toEqual({ available: 2, total: 3 });
      expect(parsed.exitCode).toBe(1);

      // New, additive.
      expect(parsed.system.paf.version).toBe('4.4.0');
      expect(parsed.system.paf.runningDiffersFromPath).toBe(true);
      expect(parsed.system.paf.pathCandidates[0].version).toBe('4.0.0');

      const jsonCodex = parsed.backends.cli.find((b: { name: string }) => b.name === 'codex');
      expect(jsonCodex.executable.selected.path).toBe(NVM_CODEX);
      expect(jsonCodex.executable.selected.version).toBe('0.153.4');
      expect(jsonCodex.executable.candidates).toHaveLength(2);
      expect(jsonCodex.executable.versionMismatch).toBe(true);
      expect(jsonCodex.model.requested).toBeNull();
      expect(jsonCodex.model.reported).toBeNull();
      expect(jsonCodex.capabilities.verification).toBe('declared-only');
      expect(parsed.advisories).toEqual(expect.arrayContaining([expect.stringContaining('first PATH match'), 'differs']));
    });

    it('never dumps the environment or config into JSON output', async () => {
      mockDetectAll.mockResolvedValue(reportWithCodexMismatch());
      const raw = (await doctor.doctor({ json: true })).output;
      const parsed = JSON.parse(raw);
      expect(parsed).not.toHaveProperty('env');
      expect(parsed).not.toHaveProperty('PATH');
      expect(parsed).not.toHaveProperty('config');
      expect(raw).not.toContain('"PATH"');
    });
  });
});

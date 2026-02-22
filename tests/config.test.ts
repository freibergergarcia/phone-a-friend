import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('config', () => {
  let config: typeof import('../src/config.js');
  let tempDir: string;

  beforeEach(async () => {
    config = await import('../src/config.js');
    tempDir = mkdtempSync(join(tmpdir(), 'paf-config-test-'));
  });

  describe('configPaths', () => {
    it('returns user config path under XDG_CONFIG_HOME when set', () => {
      const paths = config.configPaths(undefined, join(tempDir, 'xdg'));
      expect(paths.user).toBe(join(tempDir, 'xdg', 'phone-a-friend', 'config.toml'));
    });

    it('returns user config path under ~/.config by default', () => {
      const paths = config.configPaths(undefined, undefined, tempDir);
      expect(paths.user).toBe(join(tempDir, '.config', 'phone-a-friend', 'config.toml'));
    });

    it('returns repo config path when repoRoot is provided', () => {
      const paths = config.configPaths(tempDir);
      expect(paths.repo).toBe(join(tempDir, '.phone-a-friend.toml'));
    });

    it('returns null repo path when repoRoot is not provided', () => {
      const paths = config.configPaths();
      expect(paths.repo).toBeNull();
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('has expected default values', () => {
      expect(config.DEFAULT_CONFIG.defaults.backend).toBe('codex');
      expect(config.DEFAULT_CONFIG.defaults.sandbox).toBe('read-only');
      expect(config.DEFAULT_CONFIG.defaults.timeout).toBe(600);
      expect(config.DEFAULT_CONFIG.defaults.include_diff).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config files exist', () => {
      const result = config.loadConfig(undefined, join(tempDir, 'nonexistent'));
      expect(result.defaults.backend).toBe('codex');
      expect(result.defaults.timeout).toBe(600);
    });

    it('reads user config from TOML file', () => {
      const configDir = join(tempDir, 'phone-a-friend');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.toml'), [
        '[defaults]',
        'backend = "gemini"',
        'timeout = 300',
      ].join('\n'));

      const result = config.loadConfig(undefined, tempDir);
      expect(result.defaults.backend).toBe('gemini');
      expect(result.defaults.timeout).toBe(300);
      // Non-specified defaults preserved
      expect(result.defaults.sandbox).toBe('read-only');
    });

    it('merges repo config over user config', () => {
      const userDir = join(tempDir, 'user', 'phone-a-friend');
      mkdirSync(userDir, { recursive: true });
      writeFileSync(join(userDir, 'config.toml'), [
        '[defaults]',
        'backend = "gemini"',
        'timeout = 300',
      ].join('\n'));

      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, '.phone-a-friend.toml'), [
        '[defaults]',
        'backend = "codex"',
      ].join('\n'));

      const result = config.loadConfig(repoDir, join(tempDir, 'user'));
      // Repo overrides user
      expect(result.defaults.backend).toBe('codex');
      // User value preserved where repo doesn't override
      expect(result.defaults.timeout).toBe(300);
    });

    it('merges nested backend config', () => {
      const configDir = join(tempDir, 'phone-a-friend');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.toml'), [
        '[backends.ollama]',
        'host = "http://custom:11434"',
        'model = "llama3"',
      ].join('\n'));

      const result = config.loadConfig(undefined, tempDir);
      expect(result.backends?.ollama?.host).toBe('http://custom:11434');
      expect(result.backends?.ollama?.model).toBe('llama3');
    });
  });

  describe('saveConfig', () => {
    it('writes valid TOML that can be re-read', () => {
      const configPath = join(tempDir, 'config.toml');
      const testConfig = {
        defaults: { backend: 'ollama', sandbox: 'read-only' as const, timeout: 300, include_diff: true },
      };

      config.saveConfig(testConfig, configPath);

      expect(existsSync(configPath)).toBe(true);
      const content = readFileSync(configPath, 'utf-8');
      expect(content).toContain('backend = "ollama"');
      expect(content).toContain('timeout = 300');
      expect(content).toContain('include_diff = true');
    });

    it('creates parent directories if needed', () => {
      const nested = join(tempDir, 'deep', 'path', 'config.toml');
      config.saveConfig(config.DEFAULT_CONFIG, nested);
      expect(existsSync(nested)).toBe(true);
    });
  });

  describe('configInit', () => {
    it('creates default config file at specified path', () => {
      const configPath = join(tempDir, 'config.toml');
      config.configInit(configPath);
      expect(existsSync(configPath)).toBe(true);

      const loaded = config.loadConfigFromFile(configPath);
      expect(loaded.defaults.backend).toBe('codex');
    });

    it('throws when config already exists (no --force)', () => {
      const configPath = join(tempDir, 'config.toml');
      config.configInit(configPath);
      expect(() => config.configInit(configPath)).toThrow('Config already exists');
    });

    it('overwrites when force=true', () => {
      const configPath = join(tempDir, 'config.toml');
      config.saveConfig({ defaults: { backend: 'gemini', sandbox: 'read-only', timeout: 300, include_diff: true } }, configPath);
      config.configInit(configPath, true);

      const loaded = config.loadConfigFromFile(configPath);
      expect(loaded.defaults.backend).toBe('codex');
      expect(loaded.defaults.timeout).toBe(600);
    });
  });

  describe('configSet', () => {
    it('sets a string value using dot notation', () => {
      const configPath = join(tempDir, 'config.toml');
      config.saveConfig(config.DEFAULT_CONFIG, configPath);

      config.configSet('defaults.backend', 'gemini', configPath);

      const loaded = config.loadConfigFromFile(configPath);
      expect(loaded.defaults.backend).toBe('gemini');
    });

    it('converts true/false to boolean', () => {
      const configPath = join(tempDir, 'config.toml');
      config.saveConfig(config.DEFAULT_CONFIG, configPath);

      config.configSet('defaults.include_diff', 'true', configPath);
      const loaded = config.loadConfigFromFile(configPath);
      expect(loaded.defaults.include_diff).toBe(true);
    });

    it('converts bare digits to integer', () => {
      const configPath = join(tempDir, 'config.toml');
      config.saveConfig(config.DEFAULT_CONFIG, configPath);

      config.configSet('defaults.timeout', '300', configPath);
      const loaded = config.loadConfigFromFile(configPath);
      expect(loaded.defaults.timeout).toBe(300);
    });

    it('creates nested keys that do not exist', () => {
      const configPath = join(tempDir, 'config.toml');
      config.saveConfig(config.DEFAULT_CONFIG, configPath);

      config.configSet('backends.ollama.host', 'http://custom:11434', configPath);
      const loaded = config.loadConfigFromFile(configPath);
      expect(loaded.backends?.ollama?.host).toBe('http://custom:11434');
    });

    it('throws on malformed TOML instead of silently using defaults', () => {
      const configPath = join(tempDir, 'config.toml');
      writeFileSync(configPath, 'this is not valid toml [[[broken');
      expect(() => config.configSet('defaults.backend', 'gemini', configPath)).toThrow();
    });

    it('creates defaults when config file does not exist', () => {
      const configPath = join(tempDir, 'new-config.toml');
      config.configSet('defaults.backend', 'gemini', configPath);
      expect(existsSync(configPath)).toBe(true);
      const loaded = config.loadConfigFromFile(configPath);
      expect(loaded.defaults.backend).toBe('gemini');
    });
  });

  describe('configGet', () => {
    it('reads a value using dot notation', () => {
      const cfg = { defaults: { backend: 'gemini', sandbox: 'read-only', timeout: 600, include_diff: false } };
      expect(config.configGet('defaults.backend', cfg)).toBe('gemini');
    });

    it('returns undefined for missing keys', () => {
      const cfg = { defaults: { backend: 'codex', sandbox: 'read-only', timeout: 600, include_diff: false } };
      expect(config.configGet('backends.ollama.host', cfg)).toBeUndefined();
    });
  });

  describe('resolveConfig', () => {
    it('CLI flags override everything', () => {
      const configDir = join(tempDir, 'phone-a-friend');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.toml'), [
        '[defaults]',
        'backend = "gemini"',
      ].join('\n'));

      const result = config.resolveConfig(
        { to: 'codex', timeout: '120' },
        {},
        undefined,
        tempDir,
      );
      expect(result.backend).toBe('codex');
      expect(result.timeout).toBe(120);
    });

    it('env vars override config', () => {
      const result = config.resolveConfig(
        {},
        { PHONE_A_FRIEND_BACKEND: 'gemini' },
        undefined,
        join(tempDir, 'nonexistent'),
      );
      expect(result.backend).toBe('gemini');
    });

    it('config overrides defaults', () => {
      const configDir = join(tempDir, 'phone-a-friend');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.toml'), [
        '[defaults]',
        'timeout = 120',
      ].join('\n'));

      const result = config.resolveConfig({}, {}, undefined, tempDir);
      expect(result.timeout).toBe(120);
    });

    it('returns full defaults when nothing is specified', () => {
      const result = config.resolveConfig({}, {}, undefined, join(tempDir, 'nonexistent'));
      expect(result.backend).toBe('codex');
      expect(result.sandbox).toBe('read-only');
      expect(result.timeout).toBe(600);
      expect(result.includeDiff).toBe(false);
    });
  });
});

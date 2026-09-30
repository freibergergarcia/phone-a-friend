import { afterEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { configPaths, pafConfigDir } from '../src/config.js';
import { defaultTaskDbPath } from '../src/tasks.js';
import { JobManager } from '../src/jobs.js';
import { SessionStore } from '../src/sessions.js';

describe('pafConfigDir()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses XDG_CONFIG_HOME when it is set', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg/home');
    expect(pafConfigDir()).toBe(join('/xdg/home', 'phone-a-friend'));
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    expect(pafConfigDir()).toBe(join(homedir(), '.config', 'phone-a-friend'));
  });

  it('prefers an injected xdgConfigHome over the environment', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg/home');
    expect(pafConfigDir('/injected/xdg')).toBe(join('/injected/xdg', 'phone-a-friend'));
    expect(pafConfigDir('/injected/xdg', '/injected/home')).toBe(join('/injected/xdg', 'phone-a-friend'));
  });

  it('uses an injected homeDir only when no XDG base applies', () => {
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    expect(pafConfigDir(undefined, '/injected/home')).toBe(join('/injected/home', '.config', 'phone-a-friend'));
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg/home');
    expect(pafConfigDir(undefined, '/injected/home')).toBe(join('/xdg/home', 'phone-a-friend'));
  });

  it('keeps configPaths() results unchanged for injected arguments', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg/home');
    expect(configPaths('/repo', '/injected/xdg', '/injected/home')).toEqual({
      user: join('/injected/xdg', 'phone-a-friend', 'config.toml'),
      repo: join('/repo', '.phone-a-friend.toml'),
    });
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    expect(configPaths(undefined, undefined, '/injected/home')).toEqual({
      user: join('/injected/home', '.config', 'phone-a-friend', 'config.toml'),
      repo: null,
    });
  });

  // The rule is still written out in tasks.ts, jobs.ts and sessions.ts. This
  // pins all four default locations to one directory so none can drift.
  describe.each([
    ['XDG_CONFIG_HOME set', '/xdg/home'],
    ['XDG_CONFIG_HOME unset', undefined],
  ] as const)('default store locations with %s', (_label, xdg) => {
    it('puts config, tasks, jobs and sessions directly under pafConfigDir()', () => {
      vi.stubEnv('XDG_CONFIG_HOME', xdg);
      const dir = pafConfigDir();

      expect(dirname(configPaths().user)).toBe(dir);
      expect(dirname(defaultTaskDbPath())).toBe(dir);
      // Constructors only compute paths; nothing is written to disk.
      expect(dirname((new JobManager() as unknown as { filePath: string }).filePath)).toBe(dir);
      const sessions = new SessionStore() as unknown as { filePath: string; dbPath: string };
      expect(dirname(sessions.filePath)).toBe(dir);
      expect(dirname(sessions.dbPath)).toBe(dir);
    });
  });
});

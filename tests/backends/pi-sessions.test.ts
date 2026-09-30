import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import type { SandboxMode } from '../../src/backends/index.js';

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: mockExecFile, spawn: mockSpawn };
});

import {
  PI_BACKEND,
  PiBackendError,
  _resetPiVersionCache,
  findPiSessionFiles,
  piSessionDir,
  resolvePiStoredPath,
} from '../../src/backends/pi.js';
import { pafConfigDir } from '../../src/config.js';
import { relay } from '../../src/relay.js';
import { SessionStore } from '../../src/sessions.js';

const ID = '0b9d6c1e-6f0a-4b7e-9c55-2f3d1a4e8b10';
const TS = '2026-09-30T07:21:04.039Z';

function mockChild(stdout: string, exitCode = 0, opts: { stderr?: string } = {}) {
  const stdoutStream = Readable.from(stdout ? [Buffer.from(stdout)] : []);
  const stderrStream = Readable.from(opts.stderr ? [Buffer.from(opts.stderr)] : []);
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.killed = false;
  child.kill = vi.fn(() => { child.killed = true; });
  stdoutStream.on('end', () => {
    process.nextTick(() => child.emit('close', exitCode, null));
  });
  return child;
}

function headerLine(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: 'session', version: 3, ...fields });
}

/** What pi prints for a successful run on the given session header. */
function okStream(header: string, text = 'OK'): string {
  return [
    header,
    '{"type":"agent_start"}',
    JSON.stringify({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
    }),
    '{"type":"agent_settled"}',
  ].join('\n') + '\n';
}

describe('pi backend sessions', () => {
  let root: string;
  let repo: string;
  let bin: string;
  let xdg: string;
  let sessions: string;

  function makeOpts(overrides: Record<string, unknown> = {}) {
    return {
      prompt: 'Review this code',
      repoPath: repo,
      timeoutSeconds: 60,
      sandbox: 'read-only' as SandboxMode,
      model: null as string | null,
      env: { PATH: `${bin}:/usr/bin:/bin` } as Record<string, string>,
      ...overrides,
    };
  }

  const start = (overrides: Record<string, unknown> = {}) =>
    makeOpts({ sessionId: ID, persistSession: true, resumeSession: false, ...overrides });
  const resume = (overrides: Record<string, unknown> = {}) =>
    makeOpts({ sessionId: ID, persistSession: true, resumeSession: true, ...overrides });

  function spawnArgs(call = 0): string[] {
    return mockSpawn.mock.calls[call][1] as string[];
  }

  /** Write a pi session file the way pi lays it out in a custom session directory. */
  function writeSession(name: string, lines: string[]): string {
    mkdirSync(sessions, { recursive: true });
    const path = join(sessions, name);
    writeFileSync(path, lines.join('\n') + '\n');
    return path;
  }

  function repoHeader(fields: Record<string, unknown> = {}): string {
    return headerLine({ id: ID, timestamp: TS, cwd: repo, ...fields });
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'paf-pi-sessions-')));
    repo = join(root, 'repo');
    bin = join(root, 'bin');
    xdg = join(root, 'xdg');
    sessions = join(xdg, 'phone-a-friend', 'pi-sessions');
    mkdirSync(repo);
    mkdirSync(bin);
    writeFileSync(join(bin, 'pi'), '#!/bin/sh\n', { mode: 0o755 });
    vi.stubEnv('XDG_CONFIG_HOME', xdg);
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    _resetPiVersionCache();
    mockExecFile.mockImplementation((
      _path: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => cb(null, '0.87.1\n', ''));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('declares native sessions with a client-chosen ID', () => {
    expect(PI_BACKEND.capabilities).toEqual({
      resumeStrategy: 'native-session',
      requiresClientSessionId: true,
    });
  });

  describe('session directory', () => {
    it("lives under PaF's config directory, with XDG_CONFIG_HOME set or unset", () => {
      expect(piSessionDir()).toBe(sessions);
      expect(piSessionDir()).toBe(join(pafConfigDir(), 'pi-sessions'));
      vi.stubEnv('XDG_CONFIG_HOME', undefined);
      expect(piSessionDir()).toBe(join(homedir(), '.config', 'phone-a-friend', 'pi-sessions'));
    });
  });

  describe('no session', () => {
    it('passes --no-session and no session directory', async () => {
      mockSpawn.mockReturnValue(mockChild(okStream(repoHeader())));
      await PI_BACKEND.run(makeOpts());
      expect(spawnArgs()).toContain('--no-session');
      expect(spawnArgs()).not.toContain('--session-dir');
      expect(spawnArgs()).not.toContain('--session-id');
      expect(existsSync(sessions)).toBe(false);
    });
  });

  describe('start', () => {
    it("starts in PaF's session directory and reports the ID only after a matching header", async () => {
      const onSessionCreated = vi.fn();
      mockSpawn.mockImplementation(() => {
        // Nothing may be reported before the run has finished and been checked.
        expect(onSessionCreated).not.toHaveBeenCalled();
        return mockChild(okStream(repoHeader()));
      });

      await expect(PI_BACKEND.run(start({ onSessionCreated }))).resolves.toBe('OK');

      const args = spawnArgs();
      expect(args.slice(args.indexOf('--session-dir'), args.indexOf('--session-dir') + 4)).toEqual([
        '--session-dir', sessions, '--session-id', ID,
      ]);
      expect(args).not.toContain('--no-session');
      expect(mockSpawn.mock.calls[0][2].cwd).toBe(repo);
      expect(existsSync(sessions)).toBe(true);
      expect(onSessionCreated).toHaveBeenCalledTimes(1);
      expect(onSessionCreated).toHaveBeenCalledWith(ID);
    });

    it.each([
      ['a different id', { id: 'ffffffff-0000-4000-8000-000000000000' }],
      ['a different cwd', { cwd: '/somewhere/else' }],
    ])('fails the run when pi reports %s', async (_label, fields) => {
      const onSessionCreated = vi.fn();
      mockSpawn.mockReturnValue(mockChild(okStream(repoHeader(fields))));
      const attempt = PI_BACKEND.run(start({ onSessionCreated }));
      await expect(attempt).rejects.toThrow(PiBackendError);
      await expect(attempt).rejects.toThrow(/not the requested/);
      expect(onSessionCreated).not.toHaveBeenCalled();
    });

    it('fails the run when pi reports no session header', async () => {
      const onSessionCreated = vi.fn();
      const noHeader = okStream(repoHeader()).split('\n').slice(1).join('\n');
      mockSpawn.mockReturnValue(mockChild(noHeader));
      await expect(PI_BACKEND.run(start({ onSessionCreated }))).rejects.toThrow(/session header/);
      expect(onSessionCreated).not.toHaveBeenCalled();
    });

    it('does not report a session when the response failed', async () => {
      const onSessionCreated = vi.fn();
      const failed = [
        repoHeader(),
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Connection error.' },
        }),
      ].join('\n');
      mockSpawn.mockReturnValue(mockChild(failed));
      await expect(PI_BACKEND.run(start({ onSessionCreated }))).rejects.toThrow(/Connection error/);
      expect(onSessionCreated).not.toHaveBeenCalled();
    });

    it('refuses to start under an ID that already has a session for this repo', async () => {
      writeSession(`2026-09-30T07-21-04-039Z_${ID}.jsonl`, [repoHeader()]);
      await expect(PI_BACKEND.run(start())).rejects.toThrow(/already exists/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('resumes when exactly one session file matches the ID and the repo', async () => {
      writeSession(`2026-09-30T07-21-04-039Z_${ID}.jsonl`, [repoHeader(), '{"type":"message","id":"a"}']);
      const onSessionCreated = vi.fn();
      mockSpawn.mockReturnValue(mockChild(okStream(repoHeader(), 'MARMALADE')));

      await expect(PI_BACKEND.run(resume({ onSessionCreated }))).resolves.toBe('MARMALADE');

      const args = spawnArgs();
      expect(args[args.indexOf('--session-dir') + 1]).toBe(sessions);
      expect(args[args.indexOf('--session-id') + 1]).toBe(ID);
      expect(mockSpawn.mock.calls[0][2].cwd).toBe(repo);
      expect(onSessionCreated).toHaveBeenCalledWith(ID);
    });

    it('matches by header, as pi does, even when the file name does not carry the ID', async () => {
      writeSession('renamed.jsonl', [repoHeader()]);
      mockSpawn.mockReturnValue(mockChild(okStream(repoHeader())));
      await expect(PI_BACKEND.run(resume())).resolves.toBe('OK');
    });

    it('finds a header that follows blank, malformed and falsy lines, as pi does', async () => {
      writeSession(`x_${ID}.jsonl`, ['', '   ', 'not json {', 'null', '0', 'false', '""', repoHeader()]);
      mockSpawn.mockReturnValue(mockChild(okStream(repoHeader())));
      await expect(PI_BACKEND.run(resume())).resolves.toBe('OK');
    });

    it('resolves the repo through a symlink before matching the header cwd', async () => {
      const link = join(root, 'link');
      symlinkSync(repo, link);
      writeSession(`x_${ID}.jsonl`, [repoHeader()]);
      mockSpawn.mockReturnValue(mockChild(okStream(repoHeader())));
      await expect(PI_BACKEND.run(resume({ repoPath: link }))).resolves.toBe('OK');
      expect(mockSpawn.mock.calls[0][2].cwd).toBe(repo);
    });

    it("resolves a relative header cwd against the repo, not PaF's own cwd", async () => {
      // pi resolves a stored cwd against its working directory, which is the repo.
      writeSession(`x_${ID}.jsonl`, [repoHeader({ cwd: '.' })]);
      mockSpawn.mockReturnValue(mockChild(okStream(repoHeader({ cwd: '.' }))));
      await expect(PI_BACKEND.run(resume())).resolves.toBe('OK');
    });

    describe('fails before spawning', () => {
      const expectNoSpawn = async (pattern: RegExp, overrides: Record<string, unknown> = {}) => {
        const attempt = PI_BACKEND.run(resume(overrides));
        await expect(attempt).rejects.toThrow(PiBackendError);
        await expect(attempt).rejects.toThrow(pattern);
        expect(mockSpawn).not.toHaveBeenCalled();
      };

      it('when the session directory does not exist', async () => {
        await expectNoSpawn(/not found/);
        // A resume must not create the directory as a side effect.
        expect(existsSync(sessions)).toBe(false);
      });

      it('when no file carries the ID', async () => {
        writeSession('x_other.jsonl', [repoHeader({ id: 'ffffffff-0000-4000-8000-000000000000' })]);
        await expectNoSpawn(/not found/);
      });

      it('names the PaF session directory and says pi-made sessions cannot be attached', async () => {
        await expectNoSpawn(/phone-a-friend's pi session directory/);
        await expectNoSpawn(/cannot be attached/);
        const attempt = PI_BACKEND.run(resume());
        await expect(attempt).rejects.toThrow(sessions);
      });

      it("when the ID exists only under another repo's cwd", async () => {
        writeSession(`x_${ID}.jsonl`, [repoHeader({ cwd: join(root, 'other-repo') })]);
        await expectNoSpawn(/not found/);
      });

      it('when two files match the ID and the repo', async () => {
        writeSession(`a_${ID}.jsonl`, [repoHeader()]);
        writeSession(`b_${ID}.jsonl`, [repoHeader({ timestamp: '2026-09-30T08:00:00.000Z' })]);
        await expectNoSpawn(/ambiguous/);
      });

      it('when a clean file and a junk-prefixed file carry the same ID and repo', async () => {
        // pi would find both headers and open whichever comes first in
        // directory order; a first-line-only check would see just one.
        writeSession(`a_${ID}.jsonl`, [repoHeader()]);
        writeSession(`b_${ID}.jsonl`, ['', 'garbage', repoHeader()]);
        await expectNoSpawn(/ambiguous/);
      });

      it('when the first parsed entry is not a session header', async () => {
        writeSession(`x_${ID}.jsonl`, ['{"type":"message","id":"a"}', repoHeader()]);
        await expectNoSpawn(/not found/);
      });

      it('when the header lacks a string id or a cwd', async () => {
        writeSession('a.jsonl', [headerLine({ id: 5, timestamp: TS, cwd: repo })]);
        writeSession('b.jsonl', [headerLine({ id: ID, timestamp: TS })]);
        writeSession('c.jsonl', [headerLine({ id: ID, timestamp: TS, cwd: '' })]);
        await expectNoSpawn(/not found/);
      });

      it('when the file cannot be read as a file', async () => {
        mkdirSync(join(sessions, `x_${ID}.jsonl`), { recursive: true });
        await expectNoSpawn(/not found/);
      });

      it('when no header appears inside the 1 MiB scan bound', async () => {
        const padding = Array.from({ length: 1100 }, () => ' '.repeat(1023));
        writeSession(`x_${ID}.jsonl`, [...padding, repoHeader()]);
        await expectNoSpawn(/not found/);
      });

      it('when a matching ID has a cwd that cannot be resolved', async () => {
        // pi's own scan aborts on this error and would create a new session.
        writeSession(`x_${ID}.jsonl`, [repoHeader({ cwd: 'file://remote-host/repo' })]);
        await expectNoSpawn(/cannot be resolved/);
      });

      it('when the session ID is not one pi accepts', async () => {
        for (const sessionId of ['-leading', 'has space', '../up', 'a/b']) {
          await expectNoSpawn(/Invalid pi session ID/, { sessionId });
        }
      });
    });

    describe('fails the run when pi did not open the checked session', () => {
      beforeEach(() => {
        writeSession(`x_${ID}.jsonl`, [repoHeader()]);
      });

      it.each([
        ['timestamp', { timestamp: '2026-09-30T09:00:00.000Z' }],
        ['id', { id: 'ffffffff-0000-4000-8000-000000000000' }],
        ['cwd', { cwd: '/somewhere/else' }],
      ])('because the emitted header has a different %s', async (_label, fields) => {
        const onSessionCreated = vi.fn();
        mockSpawn.mockReturnValue(mockChild(okStream(repoHeader(fields))));
        const attempt = PI_BACKEND.run(resume({ onSessionCreated }));
        await expect(attempt).rejects.toThrow(PiBackendError);
        await expect(attempt).rejects.toThrow(/did not resume/);
        expect(onSessionCreated).not.toHaveBeenCalled();
      });

      it('because pi warned that it created a new session', async () => {
        mockSpawn.mockReturnValue(mockChild(okStream(repoHeader()), 0, {
          stderr: `Warning: No project session found with id '${ID}'; creating a new session with that id.\n`,
        }));
        await expect(PI_BACKEND.run(resume())).rejects.toThrow(/did not resume/);
      });

      it('because pi reported no session header', async () => {
        const noHeader = okStream(repoHeader()).split('\n').slice(1).join('\n');
        mockSpawn.mockReturnValue(mockChild(noHeader));
        await expect(PI_BACKEND.run(resume())).rejects.toThrow(/session header/);
      });
    });
  });

  describe('Windows path forms', () => {
    // Expected values are what pi's own normalizePath returns with the
    // platform set to win32 (identical on 0.87.1 and 0.99.1), followed by
    // path.win32.resolve.
    const base = 'C:\\work\\repo';
    const onWindows = (stored: string): string => resolvePiStoredPath(stored, base, 'win32');

    it('reads Git Bash, MSYS, Cygwin and WSL drive paths as pi does', () => {
      expect(onWindows('/c/work/repo')).toBe('C:\\work\\repo');
      expect(onWindows('/C/work/repo')).toBe('C:\\work\\repo');
      expect(onWindows('/mnt/c/work/repo')).toBe('C:\\work\\repo');
      expect(onWindows('/cygdrive/c/work/repo')).toBe('C:\\work\\repo');
      expect(onWindows('/c/work/../work/repo')).toBe('C:\\work\\repo');
      expect(onWindows('/d')).toBe('D:\\');
      expect(onWindows('/mnt/d')).toBe('D:\\');
    });

    it('resolves native, relative and tilde forms', () => {
      expect(onWindows('C:\\work\\repo')).toBe('C:\\work\\repo');
      expect(onWindows('C:/work/repo')).toBe('C:\\work\\repo');
      expect(onWindows('.')).toBe('C:\\work\\repo');
      expect(onWindows('~\\repo')).toBe(win32.resolve(win32.join(homedir(), 'repo')));
      expect(onWindows('~/repo')).toBe(win32.resolve(win32.join(homedir(), 'repo')));
    });

    it('leaves paths that are not drive paths alone', () => {
      expect(onWindows('//server/share/x')).toBe('\\\\server\\share\\x');
      expect(onWindows('/c\\mixed')).not.toBe('C:\\mixed');
      expect(onWindows('/cc/repo')).not.toMatch(/^C:\\repo/);
      expect(onWindows('/mnt/cc/x')).not.toMatch(/^C:\\/);
    });

    it('rewrites nothing on POSIX', () => {
      expect(resolvePiStoredPath('/c/work/repo', '/c/work/repo', 'linux')).toBe('/c/work/repo');
      expect(resolvePiStoredPath('/mnt/c/work/repo', '/c/work/repo', 'darwin')).toBe('/mnt/c/work/repo');
      expect(resolvePiStoredPath('~\\repo', '/c/work/repo', 'linux')).toBe('/c/work/repo/~\\repo');
    });

    it('counts every spelling of one Windows directory, so a duplicate is caught before spawning', () => {
      // On Windows pi matches both files and opens whichever comes first in
      // directory order. Counting only the native spelling would see one.
      writeSession(`a_${ID}.jsonl`, [headerLine({ id: ID, timestamp: TS, cwd: 'C:\\work\\repo' })]);
      writeSession(`b_${ID}.jsonl`, [headerLine({ id: ID, timestamp: '2026-09-30T08:00:00.000Z', cwd: '/c/work/repo' })]);
      writeSession(`c_${ID}.jsonl`, [headerLine({ id: ID, timestamp: '2026-09-30T09:00:00.000Z', cwd: '/mnt/c/work/repo' })]);
      writeSession(`d_${ID}.jsonl`, [headerLine({ id: ID, timestamp: '2026-09-30T10:00:00.000Z', cwd: '/c/work/other' })]);
      const matches = findPiSessionFiles(sessions, ID, 'C:\\work\\repo', 'win32');
      expect(matches.map((header) => header.cwd).sort()).toEqual(['/c/work/repo', '/mnt/c/work/repo', 'C:\\work\\repo']);
      // The same files from a POSIX repo at /c/work/repo are one session.
      expect(findPiSessionFiles(sessions, ID, '/c/work/repo', 'linux')).toHaveLength(1);
    });
  });

  describe('through relay()', () => {
    let store: SessionStore;

    beforeEach(() => {
      vi.stubEnv('PATH', `${bin}:/usr/bin:/bin`);
      vi.stubEnv('PHONE_A_FRIEND_DEPTH', '0');
      vi.stubEnv('PI_CODING_AGENT', undefined);
      vi.stubEnv('PHONE_A_FRIEND_HOST', undefined);
      store = new SessionStore(join(root, 'sessions.json'));
    });

    /** Answer like pi: echo a header for whatever --session-id was requested. */
    function answerAsPi(text = 'OK', fields: Record<string, unknown> = {}) {
      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        const id = args[args.indexOf('--session-id') + 1];
        return mockChild(okStream(headerLine({ id, timestamp: TS, cwd: repo, ...fields }), text));
      });
    }

    const relayOpts = (overrides: Record<string, unknown> = {}) => ({
      prompt: 'Remember MARMALADE',
      repoPath: repo,
      backend: 'pi',
      sessionStore: store,
      ...overrides,
    });

    it('warns about an unknown label, starts fresh, and resumes the same pi session next time', async () => {
      const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
      answerAsPi();

      await expect(relay(relayOpts({ session: 'probe' }))).resolves.toBe('OK');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Session label "probe" not found in store'));
      const stored = store.get('probe');
      expect(stored?.backend).toBe('pi');
      const id = stored?.backendSessionId as string;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(spawnArgs(0)[spawnArgs(0).indexOf('--session-id') + 1]).toBe(id);
      // native-session backends keep no transcript on PaF's side.
      expect(stored?.history).toEqual([]);

      // pi would have written this file during the first call.
      writeSession(`2026-09-30T07-21-04-039Z_${id}.jsonl`, [headerLine({ id, timestamp: TS, cwd: repo })]);
      answerAsPi('MARMALADE');

      await expect(relay(relayOpts({ session: 'probe', prompt: 'What was the word?' }))).resolves.toBe('MARMALADE');

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(spawnArgs(1)[spawnArgs(1).indexOf('--session-id') + 1]).toBe(id);
    });

    it('does not persist a label when pi reports a different session than requested', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      answerAsPi('OK', { id: 'ffffffff-0000-4000-8000-000000000000' });

      await expect(relay(relayOpts({ session: 'probe' }))).rejects.toThrow(/not the requested/);

      expect(store.get('probe')).toBeNull();
    });

    it('fails before spawning when a stored label points at a pi session that is gone', async () => {
      store.upsert({ id: 'probe', backend: 'pi', repoPath: repo, backendSessionId: ID, replaceHistory: [] });

      await expect(relay(relayOpts({ session: 'probe' }))).rejects.toThrow(/not found/);

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('attaches --backend-session to a session in the PaF directory and can adopt it under a label', async () => {
      writeSession(`x_${ID}.jsonl`, [repoHeader()]);
      answerAsPi('MARMALADE');

      await expect(relay(relayOpts({ backendSession: ID, session: 'adopted' }))).resolves.toBe('MARMALADE');

      expect(spawnArgs(0)[spawnArgs(0).indexOf('--session-id') + 1]).toBe(ID);
      expect(store.get('adopted')?.backendSessionId).toBe(ID);
    });

    it('rejects a --backend-session that is not in the PaF directory, before spawning', async () => {
      const attempt = relay(relayOpts({ backendSession: ID }));
      await expect(attempt).rejects.toThrow(/cannot be attached/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('rejects an invalid --backend-session before spawning', async () => {
      await expect(relay(relayOpts({ backendSession: 'bad id!' }))).rejects.toThrow(/Invalid pi session ID/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});

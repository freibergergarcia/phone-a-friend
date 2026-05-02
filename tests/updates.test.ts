/**
 * Tests for src/updates.ts — npm registry update notification.
 *
 * Coverage:
 *   - readSnapshot (no file / valid file / corrupt file)
 *   - writeSnapshot (atomic write, mkdir on first run)
 *   - decideBanner (every suppression rule + cooldown)
 *   - formatBanner
 *   - fetchLatestVersion (mock global fetch, success / error / timeout / non-200)
 *   - scheduleRefresh (writes cache, swallows errors, respects cooldown)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSnapshot,
  writeSnapshot,
  decideBanner,
  formatBanner,
  fetchLatestVersion,
  scheduleRefresh,
  runRefresh,
  recordNotified,
  isValidVersionString,
  isPafEntryScript,
  defaultCachePath,
  buildSuppressionContext,
  CHECK_COOLDOWN_MS,
  NOTIFY_COOLDOWN_MS,
  type UpdateCheckSnapshot,
  type SuppressionContext,
} from '../src/updates.js';

const FIXED_NOW = '2026-05-02T12:00:00.000Z';
const FIXED_NOW_MS = Date.parse(FIXED_NOW);

const ANY_TTY: SuppressionContext = {
  isStdoutTty: true,
  isStderrTty: true,
  isCi: false,
  isDumbTerm: false,
  hasMachineFlag: false,
  configEnabled: true,
  envOptedOut: false,
};

function makeSnapshot(partial: Partial<UpdateCheckSnapshot> = {}): UpdateCheckSnapshot {
  return {
    schemaVersion: 1,
    lastCheckedAt: null,
    latestVersion: null,
    lastNotifiedVersion: null,
    lastNotifiedAt: null,
    currentVersion: '2.1.0',
    ...partial,
  };
}

describe('updates', () => {
  let tmp: string;
  let cachePath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'paf-updates-'));
    cachePath = join(tmp, 'update-check.json');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // readSnapshot
  // ---------------------------------------------------------------------------

  describe('readSnapshot', () => {
    it('returns empty snapshot when file does not exist', () => {
      const snap = readSnapshot(cachePath, '2.1.0');
      expect(snap.schemaVersion).toBe(1);
      expect(snap.latestVersion).toBeNull();
      expect(snap.lastCheckedAt).toBeNull();
      expect(snap.lastNotifiedVersion).toBeNull();
      expect(snap.lastNotifiedAt).toBeNull();
      expect(snap.currentVersion).toBe('2.1.0');
    });

    it('reads valid snapshot from disk', () => {
      const expected = makeSnapshot({
        latestVersion: '2.4.0',
        lastCheckedAt: FIXED_NOW,
        lastNotifiedVersion: '2.4.0',
        lastNotifiedAt: FIXED_NOW,
      });
      writeFileSync(cachePath, JSON.stringify(expected));
      const snap = readSnapshot(cachePath, '2.1.0');
      expect(snap.latestVersion).toBe('2.4.0');
      expect(snap.lastCheckedAt).toBe(FIXED_NOW);
    });

    it('silently rotates corrupt cache aside and returns empty snapshot', () => {
      writeFileSync(cachePath, '{this is not valid json');
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const snap = readSnapshot(cachePath, '2.1.0');
      expect(snap.latestVersion).toBeNull();
      const files = readdirSync(tmp);
      const corruptFile = files.find((f) => f.startsWith('update-check.json.corrupt-'));
      expect(corruptFile).toBeDefined();
      // No stderr noise — the cache is fully regenerable on the next refresh,
      // so we keep silent to avoid contaminating --quiet / --json / doctor --json flows.
      expect(errSpy).not.toHaveBeenCalled();
    });

    it('returns empty snapshot when schemaVersion is unrecognized', () => {
      writeFileSync(
        cachePath,
        JSON.stringify({ schemaVersion: 99, latestVersion: '99.0.0' }),
      );
      const snap = readSnapshot(cachePath, '2.1.0');
      expect(snap.latestVersion).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // writeSnapshot
  // ---------------------------------------------------------------------------

  describe('writeSnapshot', () => {
    it('creates parent directory if missing', () => {
      const nested = join(tmp, 'a', 'b', 'update-check.json');
      const snap = makeSnapshot({ latestVersion: '2.4.0' });
      writeSnapshot(nested, snap);
      expect(existsSync(nested)).toBe(true);
      const content = JSON.parse(readFileSync(nested, 'utf-8'));
      expect(content.latestVersion).toBe('2.4.0');
    });

    it('writes atomically (no .tmp file left after success)', () => {
      const snap = makeSnapshot({ latestVersion: '2.4.0' });
      writeSnapshot(cachePath, snap);
      const files = readdirSync(tmp);
      const tmpFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('overwrites existing cache cleanly', () => {
      writeSnapshot(cachePath, makeSnapshot({ latestVersion: '2.0.0' }));
      writeSnapshot(cachePath, makeSnapshot({ latestVersion: '2.4.0' }));
      const content = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(content.latestVersion).toBe('2.4.0');
    });
  });

  // ---------------------------------------------------------------------------
  // decideBanner
  // ---------------------------------------------------------------------------

  describe('decideBanner', () => {
    const fresh = makeSnapshot({
      latestVersion: '2.4.0',
      lastCheckedAt: FIXED_NOW,
    });

    it('shows banner when latest > current and no suppression', () => {
      const decision = decideBanner(fresh, '2.1.0', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(true);
      if (decision.show) {
        expect(decision.latestVersion).toBe('2.4.0');
        expect(decision.currentVersion).toBe('2.1.0');
      }
    });

    it('does not show when latestVersion is null (first run)', () => {
      const empty = makeSnapshot();
      const decision = decideBanner(empty, '2.1.0', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
    });

    it('does not show when latest equals current', () => {
      const same = makeSnapshot({ latestVersion: '2.1.0', lastCheckedAt: FIXED_NOW });
      const decision = decideBanner(same, '2.1.0', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
    });

    it('does not show when latest is older than current (downgrade)', () => {
      const older = makeSnapshot({ latestVersion: '1.9.0', lastCheckedAt: FIXED_NOW });
      const decision = decideBanner(older, '2.1.0', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
    });

    it('suppresses on env opt-out', () => {
      const ctx: SuppressionContext = { ...ANY_TTY, envOptedOut: true };
      const decision = decideBanner(fresh, '2.1.0', ctx, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('env-opt-out');
    });

    it('suppresses in CI', () => {
      const ctx: SuppressionContext = { ...ANY_TTY, isCi: true };
      const decision = decideBanner(fresh, '2.1.0', ctx, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('ci');
    });

    it('suppresses on dumb terminal', () => {
      const ctx: SuppressionContext = { ...ANY_TTY, isDumbTerm: true };
      const decision = decideBanner(fresh, '2.1.0', ctx, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('dumb-term');
    });

    it('suppresses when stdout is not a TTY', () => {
      const ctx: SuppressionContext = { ...ANY_TTY, isStdoutTty: false };
      const decision = decideBanner(fresh, '2.1.0', ctx, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('no-tty');
    });

    it('suppresses when stderr is not a TTY', () => {
      const ctx: SuppressionContext = { ...ANY_TTY, isStderrTty: false };
      const decision = decideBanner(fresh, '2.1.0', ctx, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('no-tty');
    });

    it('suppresses when machine-readable flag is set', () => {
      const ctx: SuppressionContext = { ...ANY_TTY, hasMachineFlag: true };
      const decision = decideBanner(fresh, '2.1.0', ctx, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('machine-flag');
    });

    it('suppresses when config opts out', () => {
      const ctx: SuppressionContext = { ...ANY_TTY, configEnabled: false };
      const decision = decideBanner(fresh, '2.1.0', ctx, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('config-disabled');
    });

    it('suppresses when same version was notified within 7 days', () => {
      const recentlyNotified = makeSnapshot({
        latestVersion: '2.4.0',
        lastCheckedAt: FIXED_NOW,
        lastNotifiedVersion: '2.4.0',
        lastNotifiedAt: new Date(FIXED_NOW_MS - 60_000).toISOString(), // 1 min ago
      });
      const decision = decideBanner(recentlyNotified, '2.1.0', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(false);
      if (!decision.show) expect(decision.reason).toBe('recently-notified');
    });

    it('shows again after 7 days even for the same version', () => {
      const oldNotified = makeSnapshot({
        latestVersion: '2.4.0',
        lastCheckedAt: FIXED_NOW,
        lastNotifiedVersion: '2.4.0',
        lastNotifiedAt: new Date(FIXED_NOW_MS - 8 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const decision = decideBanner(oldNotified, '2.1.0', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(true);
    });

    it('shows banner for a newer version even if a different older version was just notified', () => {
      const justNotifiedOld = makeSnapshot({
        latestVersion: '2.5.0',
        lastCheckedAt: FIXED_NOW,
        lastNotifiedVersion: '2.4.0',
        lastNotifiedAt: new Date(FIXED_NOW_MS - 60_000).toISOString(),
      });
      const decision = decideBanner(justNotifiedOld, '2.1.0', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(true);
    });

    it('handles prerelease-style current version conservatively (still shows when stable is newer)', () => {
      const fresh250 = makeSnapshot({ latestVersion: '2.5.0', lastCheckedAt: FIXED_NOW });
      const decision = decideBanner(fresh250, '2.1.0-beta.1', ANY_TTY, FIXED_NOW_MS);
      expect(decision.show).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // formatBanner
  // ---------------------------------------------------------------------------

  describe('formatBanner', () => {
    it('formats with current and latest version', () => {
      const text = formatBanner('2.1.0', '2.4.0');
      expect(text).toContain('2.4.0');
      expect(text).toContain('2.1.0');
      expect(text).toContain('npm install -g @freibergergarcia/phone-a-friend@latest');
    });

    it('returns multi-line string with leading newline for breathing room', () => {
      const text = formatBanner('2.1.0', '2.4.0');
      expect(text.startsWith('\n')).toBe(true);
      expect(text.split('\n').length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchLatestVersion
  // ---------------------------------------------------------------------------

  describe('fetchLatestVersion', () => {
    it('parses dist-tags.latest from npm registry response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ latest: '2.4.0', next: '2.5.0-beta' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', mockFetch);
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBe('2.4.0');
      expect(mockFetch).toHaveBeenCalledOnce();
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('registry.npmjs.org');
      expect(url).toContain('dist-tags');
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['User-Agent']).toContain('phone-a-friend');
    });

    it('returns null on non-200 response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
      );
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });

    it('returns null on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENETUNREACH')));
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });

    it('returns null on invalid JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
      );
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });

    it('returns null when dist-tags.latest is missing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ next: '2.5.0-beta' }), { status: 200 }),
        ),
      );
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });

    it('returns null when dist-tags.latest is not a string', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: 42 }), { status: 200 }),
        ),
      );
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });

    it('returns null when fetch is aborted by timeout', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // scheduleRefresh
  // ---------------------------------------------------------------------------

  describe('scheduleRefresh', () => {
    it('skips fetch when last check is within cooldown', async () => {
      const fresh = makeSnapshot({
        latestVersion: '2.4.0',
        lastCheckedAt: new Date(FIXED_NOW_MS - 60_000).toISOString(),
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await scheduleRefresh({
        cachePath,
        currentVersion: '2.1.0',
        snapshot: fresh,
        nowMs: FIXED_NOW_MS,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches when no prior check', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: '2.4.0' }), { status: 200 }),
        ),
      );
      const empty = makeSnapshot();
      await scheduleRefresh({
        cachePath,
        currentVersion: '2.1.0',
        snapshot: empty,
        nowMs: FIXED_NOW_MS,
      });
      expect(existsSync(cachePath)).toBe(true);
      const written = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(written.latestVersion).toBe('2.4.0');
      expect(written.lastCheckedAt).toBe(new Date(FIXED_NOW_MS).toISOString());
    });

    it('fetches when last check was older than 24h', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: '2.4.0' }), { status: 200 }),
        ),
      );
      const stale = makeSnapshot({
        latestVersion: '2.3.0',
        lastCheckedAt: new Date(FIXED_NOW_MS - 25 * 60 * 60 * 1000).toISOString(),
      });
      await scheduleRefresh({
        cachePath,
        currentVersion: '2.1.0',
        snapshot: stale,
        nowMs: FIXED_NOW_MS,
      });
      const written = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(written.latestVersion).toBe('2.4.0');
    });

    it('records the attempt (advances lastCheckedAt) when fetch fails so offline users do not re-spawn every invocation', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
      const empty = makeSnapshot();
      await scheduleRefresh({
        cachePath,
        currentVersion: '2.1.0',
        snapshot: empty,
        nowMs: FIXED_NOW_MS,
      });
      expect(existsSync(cachePath)).toBe(true);
      const written = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(written.lastCheckedAt).toBe(new Date(FIXED_NOW_MS).toISOString());
      // latestVersion was null before the failed attempt and stays null —
      // we only record the attempt timestamp, not a fake version.
      expect(written.latestVersion).toBeNull();
    });

    it('preserves lastNotifiedVersion / lastNotifiedAt across refresh', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: '2.5.0' }), { status: 200 }),
        ),
      );
      const stale = makeSnapshot({
        latestVersion: '2.4.0',
        lastCheckedAt: new Date(FIXED_NOW_MS - 25 * 60 * 60 * 1000).toISOString(),
        lastNotifiedVersion: '2.4.0',
        lastNotifiedAt: new Date(FIXED_NOW_MS - 60_000).toISOString(),
      });
      // The race-mitigation re-read pulls from disk, so the disk state is what
      // matters. Write the stale snapshot to disk first so scheduleRefresh
      // reads the same notified-state we want preserved.
      writeSnapshot(cachePath, stale);
      await scheduleRefresh({
        cachePath,
        currentVersion: '2.1.0',
        snapshot: stale,
        nowMs: FIXED_NOW_MS,
      });
      const written = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(written.latestVersion).toBe('2.5.0');
      expect(written.lastNotifiedVersion).toBe('2.4.0');
      expect(written.lastNotifiedAt).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // runRefresh (the function called from inside the detached subprocess)
  // ---------------------------------------------------------------------------

  describe('runRefresh', () => {
    it('reads snapshot from disk and updates cache after fetch', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: '3.0.0' }), { status: 200 }),
        ),
      );
      // Pre-populate stale cache so we know the cooldown is bypassed.
      writeSnapshot(
        cachePath,
        makeSnapshot({
          latestVersion: '2.0.0',
          lastCheckedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        }),
      );
      await runRefresh({ cachePath, currentVersion: '2.1.0' });
      const written = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(written.latestVersion).toBe('3.0.0');
    });

    it('respects cooldown when called repeatedly', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ latest: '3.0.0' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      writeSnapshot(
        cachePath,
        makeSnapshot({
          latestVersion: '3.0.0',
          lastCheckedAt: new Date().toISOString(),
        }),
      );
      await runRefresh({ cachePath, currentVersion: '2.1.0' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // isValidVersionString — defense against malicious registry responses
  // ---------------------------------------------------------------------------

  describe('isValidVersionString', () => {
    it('accepts standard semver', () => {
      expect(isValidVersionString('2.1.0')).toBe(true);
      expect(isValidVersionString('10.20.30')).toBe(true);
      expect(isValidVersionString('1.0.0-beta.1')).toBe(true);
      expect(isValidVersionString('1.0.0+build.123')).toBe(true);
      expect(isValidVersionString('1.0.0-rc.1+build.42')).toBe(true);
    });

    it('rejects ANSI escape injection', () => {
      expect(isValidVersionString('2.1.0\x1b[31mbad')).toBe(false);
      expect(isValidVersionString('\x1b[31m2.1.0')).toBe(false);
    });

    it('rejects newlines', () => {
      expect(isValidVersionString('2.1.0\nfake banner')).toBe(false);
      expect(isValidVersionString('2.1.0\r\n')).toBe(false);
    });

    it('rejects shell metacharacters', () => {
      expect(isValidVersionString('2.1.0; rm -rf /')).toBe(false);
      expect(isValidVersionString('2.1.0`whoami`')).toBe(false);
      expect(isValidVersionString('2.1.0$(echo)')).toBe(false);
    });

    it('rejects pathologically long strings', () => {
      expect(isValidVersionString('1.0.0' + '-' + 'a'.repeat(100))).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isValidVersionString(42)).toBe(false);
      expect(isValidVersionString(null)).toBe(false);
      expect(isValidVersionString(undefined)).toBe(false);
      expect(isValidVersionString({ latest: '2.1.0' })).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidVersionString('')).toBe(false);
    });
  });

  describe('fetchLatestVersion validation', () => {
    it('rejects responses with malicious latest field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: '2.1.0\nfake banner' }), { status: 200 }),
        ),
      );
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });

    it('rejects responses with too-long latest field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: '1.0.0-' + 'a'.repeat(100) }), { status: 200 }),
        ),
      );
      const v = await fetchLatestVersion('2.1.0');
      expect(v).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Race-condition mitigation — read-modify-write
  // ---------------------------------------------------------------------------

  describe('race-condition mitigation', () => {
    it('scheduleRefresh preserves lastNotifiedVersion that was written between snapshot capture and write', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ latest: '3.0.0' }), { status: 200 }),
        ),
      );
      // Initial state: empty snapshot in-memory but disk has notify state
      // (simulating the parent recording a notify between the child's read
      // and write).
      const inMemoryStale = makeSnapshot();
      // Disk now has notify info (parent wrote it after child captured snapshot)
      writeSnapshot(
        cachePath,
        makeSnapshot({
          lastNotifiedVersion: '2.4.0',
          lastNotifiedAt: FIXED_NOW,
        }),
      );
      await scheduleRefresh({
        cachePath,
        currentVersion: '2.1.0',
        snapshot: inMemoryStale, // child's stale snapshot
      });
      const written = JSON.parse(readFileSync(cachePath, 'utf-8'));
      // Refresh fields updated from registry
      expect(written.latestVersion).toBe('3.0.0');
      expect(written.lastCheckedAt).toBeTruthy();
      // Notify state preserved (would be lost without re-read merge)
      expect(written.lastNotifiedVersion).toBe('2.4.0');
      expect(written.lastNotifiedAt).toBe(FIXED_NOW);
    });

    it('recordNotified preserves lastCheckedAt + latestVersion that the child wrote between parent snapshot and notify', () => {
      // Parent's stale in-memory snapshot
      const parentStale = makeSnapshot();
      // Disk has fresh refresh data (child wrote it after parent's snapshot)
      writeSnapshot(
        cachePath,
        makeSnapshot({
          latestVersion: '3.0.0',
          lastCheckedAt: FIXED_NOW,
        }),
      );
      recordNotified({
        cachePath,
        snapshot: parentStale,
        notifiedVersion: '3.0.0',
        nowMs: FIXED_NOW_MS,
      });
      const written = JSON.parse(readFileSync(cachePath, 'utf-8'));
      // Notify state recorded
      expect(written.lastNotifiedVersion).toBe('3.0.0');
      expect(written.lastNotifiedAt).toBe(new Date(FIXED_NOW_MS).toISOString());
      // Refresh state preserved (would be lost without re-read merge)
      expect(written.latestVersion).toBe('3.0.0');
      expect(written.lastCheckedAt).toBe(FIXED_NOW);
    });
  });

  // ---------------------------------------------------------------------------
  // defaultCachePath
  // ---------------------------------------------------------------------------

  describe('defaultCachePath', () => {
    it('uses XDG_CONFIG_HOME when set', () => {
      const path = defaultCachePath({ XDG_CONFIG_HOME: '/custom/xdg' });
      expect(path).toBe('/custom/xdg/phone-a-friend/update-check.json');
    });

    it('falls back to ~/.config when XDG_CONFIG_HOME is not set', () => {
      const path = defaultCachePath({}, '/home/test');
      expect(path).toBe('/home/test/.config/phone-a-friend/update-check.json');
    });
  });

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  describe('cooldown constants', () => {
    it('check cooldown is 24 hours', () => {
      expect(CHECK_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('notify cooldown is 7 days', () => {
      expect(NOTIFY_COOLDOWN_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('readSnapshot defense-in-depth', () => {
    it('nulls a tampered latestVersion that contains ANSI/newline payload', () => {
      const evilCache = {
        schemaVersion: 1,
        lastCheckedAt: new Date().toISOString(),
        latestVersion: '[31m9.9.9[0m\nrm -rf /',
        lastNotifiedVersion: null,
        lastNotifiedAt: null,
        currentVersion: '2.1.0',
      };
      const tmp = mkdtempSync(join(tmpdir(), 'paf-cache-evil-'));
      const p = join(tmp, 'cache.json');
      writeFileSync(p, JSON.stringify(evilCache), 'utf-8');
      const snap = readSnapshot(p, '2.1.0');
      expect(snap.latestVersion).toBeNull();
      rmSync(tmp, { recursive: true, force: true });
    });

    it('nulls an oversize latestVersion', () => {
      const evilCache = {
        schemaVersion: 1,
        lastCheckedAt: new Date().toISOString(),
        latestVersion: '1.0.0' + '-' + 'a'.repeat(200),
        lastNotifiedVersion: null,
        lastNotifiedAt: null,
        currentVersion: '2.1.0',
      };
      const tmp = mkdtempSync(join(tmpdir(), 'paf-cache-evil-'));
      const p = join(tmp, 'cache.json');
      writeFileSync(p, JSON.stringify(evilCache), 'utf-8');
      const snap = readSnapshot(p, '2.1.0');
      expect(snap.latestVersion).toBeNull();
      rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('isPafEntryScript', () => {
    it('accepts the dev wrapper / installed bin', () => {
      expect(isPafEntryScript('/usr/local/bin/phone-a-friend')).toBe(true);
      expect(isPafEntryScript('/path/to/phone-a-friend')).toBe(true);
      expect(isPafEntryScript('/path/to/phone-a-friend.js')).toBe(true);
    });

    it('accepts the npm-bundled dist entry', () => {
      expect(isPafEntryScript(
        '/usr/local/lib/node_modules/@freibergergarcia/phone-a-friend/dist/index.js',
      )).toBe(true);
    });

    it('rejects test runners and unrelated scripts', () => {
      expect(isPafEntryScript('/some/path/vitest.mjs')).toBe(false);
      expect(isPafEntryScript('/some/path/jest.js')).toBe(false);
      expect(isPafEntryScript('/some/path/index.js')).toBe(false);
      expect(isPafEntryScript('/some/path/ts-node')).toBe(false);
      expect(isPafEntryScript('')).toBe(false);
    });
  });

  describe('detectMachineFlag (subcommand-aware)', () => {
    it('detects --verdict-json', () => {
      expect(buildSuppressionContext(
        ['relay', '--review', '--verdict-json'],
        true,
        {},
      ).hasMachineFlag).toBe(true);
    });

    it('detects config show as machine-mode', () => {
      expect(buildSuppressionContext(['config', 'show'], true, {}).hasMachineFlag).toBe(true);
    });

    it('detects doctor --json as machine-mode', () => {
      expect(buildSuppressionContext(['doctor', '--json'], true, {}).hasMachineFlag).toBe(true);
    });

    it('does NOT flag plain doctor (human-readable) as machine-mode', () => {
      expect(buildSuppressionContext(['doctor'], true, {}).hasMachineFlag).toBe(false);
    });

    it('treats __update-check (the hidden refresh subcommand) as machine-mode', () => {
      expect(buildSuppressionContext(['__update-check', 'refresh'], true, {}).hasMachineFlag).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getBackend,
  registerBackend,
  checkBackends,
  _resetRegistry,
  INSTALL_HINTS,
  BackendError,
  type Backend,
  type BackendResult,
} from '../../src/backends/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockBackend(name: string): Backend {
  return {
    name,
    allowedSandboxes: new Set(['read-only', 'workspace-write', 'danger-full-access']),
    run: vi.fn(() => 'mock output'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('INSTALL_HINTS', () => {
  it('contains hints for codex and gemini', () => {
    expect(INSTALL_HINTS).toHaveProperty('codex');
    expect(INSTALL_HINTS).toHaveProperty('gemini');
    expect(typeof INSTALL_HINTS.codex).toBe('string');
    expect(typeof INSTALL_HINTS.gemini).toBe('string');
  });
});

describe('registerBackend / getBackend', () => {
  beforeEach(() => {
    _resetRegistry();
  });

  afterEach(() => {
    _resetRegistry();
  });

  it('returns a registered backend by name', () => {
    const mock = makeMockBackend('codex');
    registerBackend(mock);

    const result = getBackend('codex');
    expect(result).toBe(mock);
    expect(result.name).toBe('codex');
  });

  it('returns different backends by name', () => {
    const codex = makeMockBackend('codex');
    const gemini = makeMockBackend('gemini');
    registerBackend(codex);
    registerBackend(gemini);

    expect(getBackend('codex')).toBe(codex);
    expect(getBackend('gemini')).toBe(gemini);
  });

  it('throws BackendError for unknown backend names', () => {
    expect(() => getBackend('nonexistent')).toThrow(BackendError);
    expect(() => getBackend('nonexistent')).toThrow(
      'Unsupported relay backend: nonexistent',
    );
  });

  it('error message lists supported backends', () => {
    registerBackend(makeMockBackend('codex'));
    registerBackend(makeMockBackend('gemini'));

    try {
      getBackend('nonexistent');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/Supported: codex, gemini/);
    }
  });

  it('returned backend has required interface properties', () => {
    registerBackend(makeMockBackend('codex'));
    const backend = getBackend('codex');

    expect(backend.name).toBe('codex');
    expect(backend.allowedSandboxes).toBeDefined();
    expect(backend.allowedSandboxes.has('read-only')).toBe(true);
    expect(typeof backend.run).toBe('function');
  });
});

describe('checkBackends', () => {
  it('returns availability map for all backends in INSTALL_HINTS', () => {
    const whichFn = (name: string) => name === 'codex';

    const result = checkBackends(whichFn);
    expect(result).toHaveProperty('codex', true);
    expect(result).toHaveProperty('gemini', false);
  });

  it('returns all false when nothing is in PATH', () => {
    const result = checkBackends(() => false);
    expect(result.codex).toBe(false);
    expect(result.gemini).toBe(false);
  });

  it('returns all true when everything is in PATH', () => {
    const result = checkBackends(() => true);
    expect(result.codex).toBe(true);
    expect(result.gemini).toBe(true);
  });

  it('checks every backend in INSTALL_HINTS', () => {
    const checked: string[] = [];
    checkBackends((name) => {
      checked.push(name);
      return false;
    });

    for (const name of Object.keys(INSTALL_HINTS)) {
      expect(checked).toContain(name);
    }
  });
});

describe('BackendResult type', () => {
  it('is usable as a typed value', () => {
    const result: BackendResult = { output: 'hello', exitCode: 0 };
    expect(result.output).toBe('hello');
    expect(result.exitCode).toBe(0);
  });
});

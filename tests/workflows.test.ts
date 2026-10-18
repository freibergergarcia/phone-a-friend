/**
 * Every GitHub Action is pinned to a full commit SHA, so a moved or
 * compromised tag cannot change what runs in CI, release or npm publish.
 * Dependabot (github-actions ecosystem) bumps the SHA and the `# vX.Y.Z`
 * comment together.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS = join(__dirname, '..', '.github', 'workflows');

describe('GitHub workflows', () => {
  const files = readdirSync(WORKFLOWS).filter(name => /\.ya?ml$/.test(name));

  it('has workflows to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s pins every action to a commit SHA', file => {
    const uses = [...readFileSync(join(WORKFLOWS, file), 'utf-8').matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map(match => match[1]);
    // Local actions (./path) and docker:// images are not tag-resolved.
    const unpinned = uses.filter(ref => !ref.startsWith('./') && !ref.startsWith('docker://') && !/@[0-9a-f]{40}$/.test(ref));
    expect(unpinned).toEqual([]);
  });
});

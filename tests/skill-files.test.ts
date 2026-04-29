/**
 * File-content invariants for the canonical skills and host command shims.
 *
 * These are not unit tests of code paths — they pin the *content contract*
 * that Claude and OpenCode rely on. If someone strips Claude's Agent Teams
 * primitives out of commands/phone-a-team.md again, or accidentally
 * resurrects an OpenCode phone-a-team skill, the regression is caught here
 * before it reaches a host.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..');

function readFile(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf-8');
}

describe('Claude /phone-a-team rich command (commands/phone-a-team.md)', () => {
  const file = readFile('commands/phone-a-team.md');

  it('declares phone-a-team in frontmatter', () => {
    expect(file).toMatch(/^---\nname: phone-a-team\n/);
  });

  it('still uses Claude Agent Teams primitives', () => {
    // These are the four primitives the previous portable shim banned.
    // Claude users rely on them; restoring them is the whole point of the fix.
    expect(file).toContain('TeamCreate');
    expect(file).toContain('Task');
    expect(file).toContain('SendMessage');
    expect(file).toContain('TeamDelete');
  });

  it('supports --backend all alongside the legacy values', () => {
    expect(file).toMatch(/--backend codex\|gemini\|ollama\|both\|all/);
    expect(file).toContain('### Backend selection for `--backend all`');
  });

  it('defaults to --no-include-diff and explains why', () => {
    expect(file).toContain('### Diff inclusion policy');
    expect(file).toMatch(/--no-include-diff[^\n]*--include-diff/);
  });

  it('forbids invalid CLI shapes', () => {
    expect(file).toContain('phone-a-friend phone-a-team');
    expect(file).toContain('--to codex,gemini');
    expect(file).toMatch(/`--backend`[^\n]*not a PaF flag/);
  });

  it('uses native Agent Teams shutdown semantics', () => {
    expect(file).toContain('shutdown_approved');
    expect(file).toContain('Do NOT poll `~/.claude/teams/<team-name>/`');
    expect(file).toContain('Do not use Bash `ls`, `grep`,');
    expect(file).toContain('only cleanup wait allowed');
    expect(file).toContain('successful cleanup must be followed immediately by final text');
    expect(file).not.toContain('shutdown_response');
  });
});

describe('OpenCode does not ship a phone-a-team skill', () => {
  // /phone-a-team is Claude-only. It depends on Claude Agent Teams primitives
  // (TeamCreate, Task, SendMessage, TeamDelete) that have no OpenCode
  // equivalent. Any portable shim in skills/phone-a-team/ would re-introduce
  // the regression we just fixed; lock that out at the file-tree level.

  it('has no skills/phone-a-team directory', () => {
    expect(existsSync(join(REPO, 'skills/phone-a-team'))).toBe(false);
  });

  it('has no skills/phone-a-team/SKILL.md', () => {
    expect(existsSync(join(REPO, 'skills/phone-a-team/SKILL.md'))).toBe(false);
  });

  it('has no skills/phone-a-team/COMMAND.opencode.md overlay', () => {
    expect(existsSync(join(REPO, 'skills/phone-a-team/COMMAND.opencode.md'))).toBe(false);
  });
});

describe('Phone-a-friend skill (skills/phone-a-friend/SKILL.md)', () => {
  const file = readFile('skills/phone-a-friend/SKILL.md');

  it('defaults --no-include-diff in binary-mode example', () => {
    expect(file).toContain('--no-include-diff');
  });

  it('forbids comma-separated --to and PaF subcommand shapes', () => {
    expect(file).toContain('comma-separated');
    expect(file).toContain('phone-a-friend phone-a-team');
  });

  it('prescribes PHONE_A_FRIEND_HOST=opencode for OpenCode invocations', () => {
    expect(file).toContain('PHONE_A_FRIEND_HOST=opencode');
  });
});

describe('Curiosity-engine skill (skills/curiosity-engine/SKILL.md)', () => {
  const file = readFile('skills/curiosity-engine/SKILL.md');

  it('forbids invalid CLI shapes', () => {
    expect(file).toContain('phone-a-friend curiosity-engine');
    expect(file).toContain('comma-separated');
  });

  it('prescribes PHONE_A_FRIEND_HOST=opencode for OpenCode invocations', () => {
    expect(file).toContain('PHONE_A_FRIEND_HOST=opencode');
  });
});

describe('OpenCode shared command shims (commands/<name>.md)', () => {
  it('phone-a-friend example uses --no-include-diff', () => {
    const file = readFile('commands/phone-a-friend.md');
    expect(file).toContain('--no-include-diff');
  });
});

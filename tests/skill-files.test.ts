/**
 * File-content invariants for the canonical skills and host command shims.
 *
 * These are not unit tests of code paths — they pin the *content contract*
 * that Claude and OpenCode rely on. If someone strips Claude's Agent Teams
 * primitives out of commands/phone-a-team.md again, accidentally
 * resurrects an OpenCode phone-a-team skill, or thins out the rich Claude
 * command files back into shims, the regression is caught here before it
 * reaches a host.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..');

function readFile(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf-8');
}

/**
 * The version-tolerant probe pattern that gates --no-include-diff.
 * Any file that issues binary-mode relays must carry this probe (verbatim
 * `relay --help`, NOT bare `--help`, because top-level help does not list
 * relay flags). Pinning this guards against:
 * - regressions to a bare `--help` probe (would always fall back to env var)
 * - silent removal of the env-var fallback (would hard-fail on stale binaries)
 */
const PROBE = "phone-a-friend relay --help 2>/dev/null | grep -q -- '--no-include-diff'";
const ENV_FALLBACK = 'PHONE_A_FRIEND_INCLUDE_DIFF=false';

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

  it('uses the version-tolerant probe and env-var fallback', () => {
    expect(file).toContain(PROBE);
    expect(file).toContain(ENV_FALLBACK);
    // Must reference the gate variable in worker/lead command templates.
    expect(file).toContain('$PAF_NO_DIFF');
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

  it('instructs workers to exit after approving shutdown', () => {
    // Belt-and-suspenders for models that interpret "approve" as plain-text "OK".
    // Without an explicit exit instruction, a teammate could acknowledge and hang.
    // Asserts the phrase appears in BOTH WORKER blocks (helper-mode + direct-mode);
    // a regression that loses one block would otherwise pass with a single occurrence.
    const occurrences = file.match(/exit your process/g) ?? [];
    expect(occurrences.length).toBe(2);
    expect(file).toContain('stay active waiting for follow-up');
    expect(file).toContain('shutdown response unless explicitly recovering');
  });
});

describe('Claude /phone-a-friend rich command (commands/phone-a-friend.md)', () => {
  const file = readFile('commands/phone-a-friend.md');

  it('declares phone-a-friend in frontmatter with argument-hint', () => {
    expect(file).toMatch(/^---\nname: phone-a-friend\n/);
    expect(file).toMatch(/argument-hint:\s*\[optional review focus\]/);
  });

  it('contains the rich workflow (not a thin shim)', () => {
    // The previous regression replaced this file with a 22-line shim that
    // delegated to the skill. The rich workflow includes these section
    // headings; together they are infeasible to fit in a shim.
    expect(file).toContain('## Workflow');
    expect(file).toContain('## Gemini Model Priority');
    expect(file).toContain('## Session continuity');
    expect(file).toContain('## Speed optimization');
    expect(file).toContain('Direct call reference');
    // Length floor: the rich command is ~250 lines; a shim was ~22.
    const lineCount = file.split('\n').length;
    expect(lineCount).toBeGreaterThan(150);
  });

  it('uses the version-tolerant probe and env-var fallback', () => {
    expect(file).toContain(PROBE);
    expect(file).toContain(ENV_FALLBACK);
    expect(file).toContain('$PAF_NO_DIFF');
  });

  it('does not hardcode a single backend in its example commands', () => {
    // The shim regression hardcoded `--to codex` in the only example.
    // Rich content shows multiple backends so the model routes by intent.
    expect(file).toContain('--to gemini');
    expect(file).toContain('--to codex');
  });

  it('does not frame Claude content as OpenCode-conditional', () => {
    // The shim heading "Execution constraints when running from OpenCode"
    // weakened the rules for Claude users. Rich content uses host-neutral
    // framing.
    expect(file).not.toContain('when running from OpenCode');
  });

  it('does not direct-mode-leak PaF-only flags', () => {
    // PaF flags (--no-include-diff, --fast, --session) only exist on the
    // `phone-a-friend` binary. They must not appear in direct-mode codex/
    // gemini templates.
    expect(file).toMatch(/`--no-include-diff`[^\n]*only available in binary mode|do NOT pass PaF flags|only available in binary mode/);
  });
});

describe('Claude /curiosity-engine rich command (commands/curiosity-engine.md)', () => {
  const file = readFile('commands/curiosity-engine.md');

  it('declares curiosity-engine in frontmatter with argument-hint', () => {
    expect(file).toMatch(/^---\nname: curiosity-engine\n/);
    expect(file).toMatch(/argument-hint:\s*--topic/);
  });

  it('contains the full Q&A protocol (not a thin shim)', () => {
    // Without these, the slash command is nonfunctional as a curiosity rally.
    expect(file).toContain('ANSWER:');
    expect(file).toContain('QUESTION:');
    expect(file).toContain('## Step 3 — Serve Round 1');
    expect(file).toContain('## Step 4 — Parse Backend Response');
    expect(file).toContain('## Step 6 — Final Synthesis');
    // Length floor: the rich command is ~350 lines; a shim was ~13.
    const lineCount = file.split('\n').length;
    expect(lineCount).toBeGreaterThan(200);
  });

  it('uses the version-tolerant probe and env-var fallback', () => {
    // Curiosity-engine had ZERO --no-include-diff references before the fix.
    // This test pins the suppression now in place.
    expect(file).toContain(PROBE);
    expect(file).toContain(ENV_FALLBACK);
    expect(file).toContain('$PAF_NO_DIFF');
  });

  it('gates every binary-mode relay invocation with $PAF_NO_DIFF', () => {
    // Find all binary-mode relay invocations (lines starting with
    // `phone-a-friend --to <BACKEND>`). Each should reference the gate.
    const lines = file.split('\n');
    const relayLines = lines.filter(line =>
      /^\s*phone-a-friend --to <BACKEND>/.test(line) ||
      /^\s*phone-a-friend --to gemini --model/.test(line)
    );
    expect(relayLines.length).toBeGreaterThan(0);
    for (const line of relayLines) {
      expect(line).toContain('$PAF_NO_DIFF');
    }
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

  it('uses the version-tolerant probe and env-var fallback', () => {
    expect(file).toContain(PROBE);
    expect(file).toContain(ENV_FALLBACK);
    expect(file).toContain('$PAF_NO_DIFF');
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

  it('uses the version-tolerant probe and env-var fallback', () => {
    expect(file).toContain(PROBE);
    expect(file).toContain(ENV_FALLBACK);
    expect(file).toContain('$PAF_NO_DIFF');
  });
});

describe('OpenCode command overlays (skills/<name>/COMMAND.opencode.md)', () => {
  // These overlays are the OpenCode entry point for the slash command.
  // The installer's opencodeCommandSource() prefers them over the
  // host-neutral commands/<name>.md when present, so OpenCode gets a thin
  // shim that delegates to the rich SKILL.md while Claude gets the rich
  // commands/<name>.md inline.
  //
  // Design choice: the OpenCode shims use the env-var-only suppression
  // (`PHONE_A_FRIEND_INCLUDE_DIFF=false`), NOT the probe-and-gate pattern.
  // Rationale: smoke testing showed that small models running in OpenCode
  // (e.g. gpt-oss-120b) skip the probe block and inline `--no-include-diff`
  // verbatim, which fails on stale CLIs. The env var is one line, can't
  // be skipped, and works on every shipped binary (v1.7.2+). Reliability
  // beats elegance at the entry point.

  for (const name of ['phone-a-friend', 'curiosity-engine']) {
    describe(`${name} overlay`, () => {
      const path = join(REPO, `skills/${name}/COMMAND.opencode.md`);

      it('exists', () => {
        expect(existsSync(path)).toBe(true);
      });

      it('sets PHONE_A_FRIEND_HOST=opencode for the recursion guard', () => {
        const file = readFileSync(path, 'utf-8');
        expect(file).toContain('PHONE_A_FRIEND_HOST=opencode');
      });

      it('uses PHONE_A_FRIEND_INCLUDE_DIFF=false for diff suppression', () => {
        const file = readFileSync(path, 'utf-8');
        expect(file).toContain(ENV_FALLBACK);
      });

      it('does NOT mention $PAF_NO_DIFF (probe variable belongs in rich content only)', () => {
        const file = readFileSync(path, 'utf-8');
        expect(file).not.toContain('$PAF_NO_DIFF');
      });

      it('does NOT use --no-include-diff as a literal flag (small models would copy it onto stale binaries)', () => {
        const file = readFileSync(path, 'utf-8');
        // Allow the flag inside markdown inline code (backticks) for prose
        // explanations. Forbid it as an actual command argument.
        // The negative lookbehind ensures the flag isn't immediately preceded
        // by a backtick (markdown formatting).
        expect(file).not.toMatch(/(?<!`)--no-include-diff/);
      });
    });
  }
});

describe('Curiosity-engine is host-neutral about the orchestrator', () => {
  // The skill ships in OpenCode now, so the orchestrator is "Claude in
  // Claude Code" but "the OpenCode model in OpenCode". Smoke testing
  // showed that small models read "Claude serves first" as an instruction
  // to relay to `phone-a-friend --to claude`. Pin host-neutral phrasing.

  for (const rel of ['commands/curiosity-engine.md', 'skills/curiosity-engine/SKILL.md']) {
    describe(rel, () => {
      const file = readFile(rel);

      it('description does not lock the orchestrator to Claude', () => {
        // Frontmatter description is what shows in skill listings.
        const fm = file.match(/^---\n([\s\S]+?)\n---/)?.[1] ?? '';
        expect(fm).toContain('description:');
        expect(fm).not.toMatch(/description:[^\n]*Q&A rally between Claude/);
      });

      it('forbids relaying the orchestrator role to a backend', () => {
        // Hard rule that prevents the smoke-test failure mode. The rule may
        // wrap across newlines because of markdown line wrapping.
        expect(file).toMatch(/Do (?:NOT|not) call\s+`phone-a-friend --to claude`/);
      });

      it('uses orchestrator-neutral phrasing in round flow', () => {
        // These exact phrases were the source of the smoke-test bug.
        expect(file).not.toContain('Claude serves first');
        expect(file).not.toContain("Claude's question for you");
        expect(file).not.toContain("Claude's question");
        expect(file).not.toContain("question for Claude");
        expect(file).not.toContain("Claude never breaks the schema");
      });

      it('teaches the orchestrator role with host-neutral wording', () => {
        // At least one of these neutral phrases must appear.
        expect(file).toMatch(/orchestrating agent|orchestrator/);
      });
    });
  }
});

describe('Probe pattern uses subcommand help, not top-level help', () => {
  // Top-level `phone-a-friend --help` lists subcommands but NOT relay flags
  // (relay-specific flags live under `phone-a-friend relay --help`).
  // A bare `phone-a-friend --help | grep` probe always returns false even
  // on new binaries, silently disabling the explicit flag and forcing the
  // env-var fallback. Pin the correct subcommand probe.
  //
  // Rich content (commands/* and skills/*/SKILL.md) MUST contain the
  // probe — capable orchestrators use it to prefer the cleaner flag.
  // OpenCode overlays explicitly do NOT use the probe (covered by a
  // separate suite above).

  const richContentFiles = [
    'commands/phone-a-friend.md',
    'commands/curiosity-engine.md',
    'commands/phone-a-team.md',
    'skills/phone-a-friend/SKILL.md',
    'skills/curiosity-engine/SKILL.md',
  ];

  for (const rel of richContentFiles) {
    it(`${rel} uses 'relay --help' not bare '--help'`, () => {
      const file = readFile(rel);
      const probeLines = file
        .split('\n')
        .filter(line => line.includes("grep -q -- '--no-include-diff'"));
      // Rich content must always have at least one probe line.
      expect(probeLines.length).toBeGreaterThan(0);
      for (const line of probeLines) {
        expect(line).toContain('relay --help');
      }
    });
  }
});

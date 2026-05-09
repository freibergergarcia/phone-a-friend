# Backend Sandbox Redesign Scope

Date: 2026-05-09

This note records why three Codex-generated sandbox hardening PRs were closed
instead of merged:

- #109, OpenCode backend sandbox enforcement
- #110, Codex native review/resume sandbox fail-closed behavior
- #120, Gemini read-only sandbox rejection

## Decision

Do not merge those PRs as patch-level fixes.

They correctly identify that some backend CLIs do not expose the same sandbox
controls as Phone-a-Friend's `read-only`, `workspace-write`, and
`danger-full-access` vocabulary. The proposed fixes were still too blunt: they
would make common existing commands fail, including default Gemini and OpenCode
relay usage and default Codex review/session workflows.

## Why They Were Dropped

The risky behavior is a product contract problem, not only a one-line backend
guard problem.

- OpenCode currently manages its own tool permissions. Treating it as only
  `danger-full-access` would break normal `phone-a-friend --to opencode` usage.
- Codex native `review` and `resume` paths need a real fallback or documented
  opt-in. Failing closed at the backend boundary breaks default `--review`
  instead of preserving the user workflow.
- Gemini's CLI sandbox is boolean. Rejecting `read-only` outright breaks the
  default PaF sandbox because `read-only` is the default mode.

## Follow-Up Shape

A safe redesign should make backend-specific enforcement explicit without
surprising existing users.

Expected follow-up work:

- Document which backend sandbox modes are strict, host-managed, or best-effort.
- Show that status in `doctor` and the TUI before changing defaults.
- Preserve existing default relay behavior unless the user opts into stricter
  fail-closed enforcement.
- Prefer clear warnings and capability metadata over silently mapping different
  backend semantics to the same PaF mode.
- Add migration notes before any behavior change that turns a previously working
  default command into an error.

Until that design exists, the safer action is to close #109, #110, and #120 and
keep their findings linked from this tracking note.

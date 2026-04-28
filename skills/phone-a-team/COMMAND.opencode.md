---
description: Run a Phone-a-Friend team: multiple model reviewers, Codex and Gemini together, or iterative multi-backend refinement.
---

Use the `phone-a-team` skill with this exact user request:

$ARGUMENTS

Execution constraints:

- `phone-a-team` is an OpenCode slash command / Agent Skill, not a
  `phone-a-friend` CLI subcommand.
- Never run `phone-a-friend phone-a-team`.
- Never pass comma-separated backends to `--to` (e.g.
  `phone-a-friend --to codex,gemini`). PaF is one backend per call.
- Never pass `--backend` to the `phone-a-friend` CLI. `--backend` is a
  `/phone-a-team` skill argument, not a PaF flag.
- Use portable shell background jobs for parallel backend execution. Claude
  Agent Teams primitives (TeamCreate, Task, SendMessage, TeamDelete) are not
  available in OpenCode.
- Prefix all `phone-a-friend` invocations with `PHONE_A_FRIEND_HOST=opencode`
  so PaF can deterministically detect the host and apply the recursion guard.
- Preserve the user's task and options.

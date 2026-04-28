---
description: Run a Phone-a-Friend team: multiple model reviewers, Codex and Gemini together, or iterative multi-backend refinement.
---

Use the `phone-a-team` skill with this exact user request:

$ARGUMENTS

Execution constraints:

- `phone-a-team` is an OpenCode slash command / Agent Skill, not a
  `phone-a-friend` CLI subcommand.
- Never run `phone-a-friend phone-a-team`.
- Do not use Claude Agent Teams tools.
- Do not call `TeamCreate`, `Task`, `SendMessage`, or `TeamDelete`.
- Use portable shell background jobs for parallel backend execution.
- Preserve the user's task and options.

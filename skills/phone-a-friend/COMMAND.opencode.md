---
description: Ask another model for a second opinion through Phone-a-Friend.
---

Use the `phone-a-friend` skill with this exact user request:

$ARGUMENTS

OpenCode-specific execution rules:

- Run inside OpenCode means the current process IS OpenCode. Do not select
  `opencode` as the friend backend — PaF blocks that with a recursion guard.
  Choose `codex`, `gemini`, `claude`, or `ollama` instead.
- Prefix every relay invocation with `PHONE_A_FRIEND_HOST=opencode` so the
  recursion guard fires deterministically (the install shims set this for
  you, but be explicit when constructing commands).
- Always prefix relay invocations with `PHONE_A_FRIEND_INCLUDE_DIFF=false`
  to suppress the working-tree diff. This env var works on every shipped
  PaF binary (v1.7.2 and later). Do not pass `--no-include-diff` as a
  CLI flag — older binaries reject it with `unknown option`.
- Preserve the user's request in `--prompt`. Do not run a bare
  `phone-a-friend --to <backend> --review` unless the user explicitly asked
  to review the current diff or branch changes.

Example (sanity-review prompt mode):

```bash
PHONE_A_FRIEND_HOST=opencode PHONE_A_FRIEND_INCLUDE_DIFF=false \
  phone-a-friend --to codex --repo "$PWD" \
  --prompt "$ARGUMENTS" --timeout 300 --no-stream --fast
```

Defer to the canonical `phone-a-friend` skill for workflow details, Gemini
model priority, and session continuity.

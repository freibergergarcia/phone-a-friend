---
description: Ask another model for a second opinion through Phone-a-Friend.
---

Use the `phone-a-friend` skill with this exact user request:

$ARGUMENTS

Execution constraints when running from OpenCode:

- Do not run a bare `phone-a-friend --to <backend> --review` unless the user
  explicitly asks to review the current diff or changes.
- Preserve the user's request in `--prompt`.
- Do not select `opencode` as the friend backend from inside OpenCode.
- For a short sanity review, prefer a simple prompt-mode command:

```bash
phone-a-friend --to codex --repo "$PWD" --prompt "$ARGUMENTS" --timeout 300 --no-stream --fast
```

---
description: Run a structured Q&A rally between the current agent and another backend model through Phone-a-Friend.
---

Use the `curiosity-engine` skill with this exact user request:

$ARGUMENTS

Execution constraints:

- Preserve the user's topic, backend, and round-count arguments.
- Do not run a nested `curiosity-engine` session.
- Use `phone-a-friend` as a black box. Do not modify its internals.

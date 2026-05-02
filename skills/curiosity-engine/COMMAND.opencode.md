---
description: Run a structured Q&A rally between the current agent and another backend model through Phone-a-Friend.
---

Use the `curiosity-engine` skill with this exact user request:

$ARGUMENTS

OpenCode-specific execution rules:

- Preserve the user's topic, backend, and round-count arguments.
- Do not run a nested `curiosity-engine` session.
- Use `phone-a-friend` as a black box. Do not modify its internals.
- Prefix every relay invocation with `PHONE_A_FRIEND_HOST=opencode` so the
  recursion guard fires deterministically (the install shims set this for
  you, but be explicit when constructing commands).
- Always prefix relay invocations with `PHONE_A_FRIEND_INCLUDE_DIFF=false`
  to suppress the working-tree diff. This env var works on every shipped
  PaF binary (v1.7.2 and later). Do not pass `--no-include-diff` as a
  CLI flag — older binaries reject it with `unknown option`.
- The host model running this skill (the OpenCode model) is the
  orchestrator that serves the opening question. Do NOT call
  `phone-a-friend --to claude` to generate the opening question.

Defer to the canonical `curiosity-engine` skill for parsing, round
orchestration, schema enforcement, and Gemini model selection. The skill is
host-agnostic; the only OpenCode-specific bits are the host-marker prefix,
the env-var diff suppression, and the orchestrator-is-the-host rule above.

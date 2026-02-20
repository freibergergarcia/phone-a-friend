---
name: phone-a-friend
description: Relay task context + latest response to Codex for feedback, then continue with that feedback.
argument-hint: [optional review focus]
---

# /phone-a-friend

Use this command after an assistant reply you want reviewed by Codex.

## Goal

Send compact task context + the latest assistant reply to Codex using `phone-a-friend`, then bring Codex feedback back into the current conversation.

## Inputs

- Review focus (optional): `$ARGUMENTS`

## Workflow

1. Identify:
   - The latest relevant user request.
   - The most recent assistant reply to review.
2. Build relay prompt:
   - If `$ARGUMENTS` is non-empty: `Review this response in context and provide your opinion. Focus: $ARGUMENTS`
   - Otherwise: `Review this response in context and provide your opinion. Focus on correctness, risks, and missing assumptions.`
3. Build context payload:

```text
Task Context:
<latest relevant user request>

Assistant Response:
<latest assistant reply>

Review Request:
I'm working on this task and got the above response. Please review it and return:
1) Verdict: agree / partly agree / disagree
2) Corrections or risks
3) A revised concise answer
```

4. Run:

```bash
./phone-a-friend --to codex --repo "$PWD" --prompt "<relay-prompt>" --context-text "<context-payload>"
```

5. Return Codex feedback in concise review format:
   - Critical issues
   - Important issues
   - Suggested fixes

## Notes

- Prefer `--context-text` for small payloads.
- `--context-file` and `--context-text` are mutually exclusive.
- If context is too large for inline args, use a repo-local temp file.

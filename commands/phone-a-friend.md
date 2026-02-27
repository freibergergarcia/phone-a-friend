---
name: phone-a-friend
description: Relay task context + latest response to a backend (Codex, Gemini, or Ollama) for feedback, then continue with that feedback.
argument-hint: [optional review focus]
---

# /phone-a-friend

Use this command after an assistant reply you want reviewed by another AI.

## Goal

Send compact task context + the latest assistant reply to a backend (Codex, Gemini, or Ollama) using `phone-a-friend`, then bring the feedback back into the current conversation.

## Inputs

- Review focus (optional): `$ARGUMENTS`

## Relay mode

```bash
command -v phone-a-friend
```

- If found: set `RELAY_MODE = binary`
- If not found: set `RELAY_MODE = direct`

No hard abort. The skill continues either way.

### Direct call reference

When `RELAY_MODE = direct`, call backend CLIs directly instead of using the
`phone-a-friend` binary:

| Backend | Direct command |
|---------|---------------|
| **Codex** | `codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<combined-prompt>"` |
| **Gemini** | `gemini --sandbox --yolo --include-directories "$PWD" --output-format text -m <model> --prompt "<combined-prompt>"` |

In direct mode, combine prompt + context into a single string using this
template:

```
You are helping another coding agent by reviewing or advising on work in a local repository.
Repository path: <repo-path>
Use the repository files for context when needed.
Respond with concise, actionable feedback.

Request:
<relay-prompt>

Additional Context:
<context-payload>
```

In direct mode, also verify the backend CLI is available (`command -v codex` or
`command -v gemini`) before calling it. If not found, tell the user how to
install it and stop.

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

   **Binary mode** (`RELAY_MODE = binary`):
   ```bash
   phone-a-friend --to codex --repo "$PWD" --prompt "<relay-prompt>" --context-text "<context-payload>"
   # For gemini, always include --model (see "Gemini Model Priority" below):
   phone-a-friend --to gemini --repo "$PWD" --prompt "<relay-prompt>" --context-text "<context-payload>" --model <model>
   ```

   **Direct mode** (`RELAY_MODE = direct`):
   ```bash
   # Codex:
   codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<combined-prompt>"
   # Gemini (always include -m, see "Gemini Model Priority" below):
   gemini --sandbox --yolo --include-directories "$PWD" --output-format text -m <model> --prompt "<combined-prompt>"
   ```

   In direct mode, build `<combined-prompt>` using the template from the
   "Direct call reference" section, substituting `<relay-prompt>` and
   `<context-payload>` into the template.

5. Return backend feedback in concise review format:
   - Critical issues
   - Important issues
   - Suggested fixes

## Gemini Model Priority

When using `--to gemini`, **always** pass `--model` using the first model from
this priority list. Never use aliases (`auto`, `pro`, `flash`) — use concrete
model names only:

### Why we bypass auto-routing

Gemini CLI has built-in model fallback via auto mode, but it does NOT work in
headless/non-interactive mode. `--yolo` (and `--approval-mode yolo`) only
auto-approve tool calls, not model switch prompts. When Gemini hits a capacity
error in headless mode, it tries to prompt for consent and fails
(`google-gemini/gemini-cli#13561`). By passing `--model` explicitly, we bypass
this broken behavior and handle retry/fallback ourselves.

### Priority rationale

As of 2026-02-22, `gemini-3.1-pro-preview-*` models return 404 (not yet
deployed) and `gemini-2.5-pro` is perpetually at capacity (429). Based on
empirical testing across 10+ relay sessions, `gemini-2.5-flash` is the only
model that reliably works. Lead with what works; fall forward to newer models
as they become available.

1. `gemini-2.5-flash` — reliable, fast, confirmed working
2. `gemini-2.5-pro` — higher capability but frequently at capacity (429)
3. `gemini-2.5-flash-lite` — last resort
4. `gemini-3.1-pro-preview-customtools` — not yet deployed (404 as of 2026-02-22)
5. `gemini-3.1-pro-preview` — not yet deployed (404 as of 2026-02-22)

### Fallback rule

On Gemini relay failure, retry with the next model **only** for transient or
capacity errors:

- **Retry with next model**: HTTP 429, 499, 500, 503, 504; RESOURCE_EXHAUSTED;
  "high demand"; model not found; transient/timeout errors
- **Do NOT retry**: authentication failures, invalid arguments, prompt errors,
  permission errors
- **Default**: if an error cannot be confidently classified as transient, do
  NOT model-fallback — report the error immediately

After exhausting all models, stop and report the error with the list of
attempted models.

This does NOT apply to `--to codex`.

## Notes

- Prefer `--context-text` for small payloads.
- `--context-file` and `--context-text` are mutually exclusive.
- If context is too large for inline args, use a repo-local temp file.

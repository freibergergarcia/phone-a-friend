---
name: phone-a-team
description: Use when the user asks for a Phone-a-Friend team, multiple model reviewers, Codex and Gemini together, parallel second opinions, or iterative multi-backend refinement through phone-a-friend.
argument-hint: <task description> [--backend codex|gemini|ollama|both|all] [--max-rounds N] [--model <name>]
disable-model-invocation: true
---

# /phone-a-team

Run an iterative refinement loop by delegating work to one or more friend
backends through `phone-a-friend`, reviewing the outputs, then optionally
asking follow-up rounds until the result converges.

This skill must work from both Claude Code and OpenCode. Do not use Claude
Agent Teams primitives such as `TeamCreate`, `Task`, `SendMessage`, or
`TeamDelete`. Parallelism is done with normal shell background jobs.

## Inputs

- User arguments: `$ARGUMENTS`
- Current repository: `$PWD`

Parse:

- `--backend codex|gemini|ollama|both|all`
  - Default: `codex`
  - `both` means `codex` and `gemini`
  - `all` runs every available friend backend in parallel (see "Backend
    selection" below for the resolution logic)
- `--max-rounds N`
  - Default: `3`
  - Clamp to `1..5`
- `--model <name>`
  - Backend model override, mostly for Gemini/Ollama
- `--sandbox <mode>`
  - Default: `read-only`
- `--include-diff`
  - Pass through to `phone-a-friend`. Only set this when the user explicitly
    asked to review the working-tree diff, branch changes, or staged changes.
    Otherwise pass `--no-include-diff` (default).
- Remaining text is the task description.

If the task description is empty, ask the user for it before starting.

## Execution Rules

- Use the `phone-a-friend` CLI as a black box.
- `phone-a-team` is this host command / Agent Skill, not a
  `phone-a-friend` CLI subcommand. Never run `phone-a-friend phone-a-team`.
- Never pass comma-separated backends to `--to` (e.g.
  `phone-a-friend --to codex,gemini`). PaF is one backend per call. Run
  multiple separate `phone-a-friend` calls instead.
- Never pass `--backend` to the `phone-a-friend` CLI. `--backend` is an
  argument to this skill, not a PaF flag.
- Do not invoke `/phone-a-team` from inside `/phone-a-team`.
- Preserve the user's task in every relay prompt.
- Do not edit files yourself unless the user explicitly asks for implementation.
- Use `phone-a-friend --timeout <seconds>` for timeout control. Do not rely on
  GNU `timeout`; it is not available on all supported systems.
- Quote by writing prompts to temp files, then pass file contents through
  command substitution only when necessary.
- Preserve stdout, stderr, and exit code per backend.
- Clean up temp files with `trap`.
- Pass `--no-include-diff` on every PaF relay command unless the user
  explicitly asked for a diff/branch/staged review. PaF reads
  `defaults.include_diff` from user config; without `--no-include-diff` a
  user with `defaults.include_diff = true` would silently leak the working
  tree diff into every backend.
- Prefix every `phone-a-friend` invocation with `PHONE_A_FRIEND_HOST=opencode`
  when this skill is running inside OpenCode, so PaF can deterministically
  detect the host (recursion guard + `--backend all` exclusion).

## Preflight

Check the `phone-a-friend` binary:

```bash
command -v phone-a-friend
```

If missing, stop and tell the user to install it:

```bash
npm install -g @freibergergarcia/phone-a-friend
```

### Backend selection

Resolve `--backend <value>` into a concrete `BACKENDS` list:

| `--backend` | Backends evaluated |
|-------------|--------------------|
| `codex` (default) | `codex` |
| `gemini` | `gemini` |
| `ollama` | `ollama` |
| `both` | `codex`, `gemini` |
| `all` | `codex`, `gemini`, `claude`, `ollama`, plus `opencode` only if the host is NOT OpenCode |

Then run availability checks per backend. `command -v` proves the binary
exists, but does NOT prove the backend is usable; preflight must also probe
auth/runtime state where it is cheap to do so.

| Backend | Probe |
|---------|-------|
| `codex` | `command -v codex` AND `codex --version` succeeds |
| `gemini` | `command -v gemini` (auth checked when the relay runs; transient errors are handled by Gemini Model Priority retry rules below) |
| `claude` | `command -v claude` AND `claude --version` succeeds. Auth: a real probe requires an actual call. Defer auth verification to the relay attempt and treat auth failures as a skip-with-reason at runtime |
| `ollama` | `curl -sf "${OLLAMA_HOST:-http://localhost:11434}/api/tags"` succeeds AND the parsed `models[]` array has at least one entry |
| `opencode` | `command -v opencode` AND host is NOT OpenCode (env: `PHONE_A_FRIEND_HOST=opencode` means we are inside OpenCode; never relay to opencode in that case) |

For `--backend all`, build `BACKENDS` from the matrix above, run probes, and
emit a one-line summary:

```text
Used: codex, gemini, ollama
Skipped: claude (auth failed), opencode (host is opencode)
```

Skip silently is forbidden: every excluded backend must be listed with the
reason. If zero backends pass probes, abort and tell the user; do not start
the round loop.

For `both`, require `codex` and `gemini`. If one is missing, continue with the
available backend only after clearly telling the user.

For single-backend modes (`codex`, `gemini`, `ollama`), abort if the chosen
backend fails its probe.

## Round Loop

Maintain:

- `ROUND`
- `MAX_ROUNDS`
- `BACKENDS`
- `TRANSCRIPT`
- `CONVERGED`

Each round has three phases:

1. Build prompts.
2. Run backend relays.
3. Review outputs and decide whether another round is needed.

### Initial Round Prompt

For each backend, create a focused prompt:

```text
You are helping another coding agent by independently working on this task.

Task:
<task description>

Round:
<ROUND> of <MAX_ROUNDS>

Return:
1. Your answer or proposed solution.
2. Important risks, missing assumptions, or edge cases.
3. Concrete next steps.

Do not edit files. Return text only.
```

If this is a follow-up round, append:

```text
Previous outputs and reviewer feedback:
<summary of prior round>

Focus this round on addressing the feedback above. Avoid repeating already
settled points unless they change your conclusion.
```

### Single Backend Execution

For one backend, run directly and capture output:

```bash
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

PROMPT_FILE="$TMPDIR/prompt.txt"
OUT_FILE="$TMPDIR/<backend>.out"

# Write the prompt to "$PROMPT_FILE" using a shell-safe method in the active tool.

phone-a-friend \
  --to <backend> \
  --repo "$PWD" \
  --prompt "$(cat "$PROMPT_FILE")" \
  --sandbox <sandbox> \
  --timeout 600 \
  --no-stream \
  --fast \
  [--model <model>] \
  --no-include-diff \      # or --include-diff if user asked for diff/branch/staged review
  > "$OUT_FILE" 2>&1

STATUS=$?
```

Read `OUT_FILE` and keep both `STATUS` and full output.

### Parallel Backend Execution

For `--backend both`, run Codex and Gemini in parallel:

```bash
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

CODEX_PROMPT="$TMPDIR/codex.prompt.txt"
GEMINI_PROMPT="$TMPDIR/gemini.prompt.txt"
CODEX_OUT="$TMPDIR/codex.out"
GEMINI_OUT="$TMPDIR/gemini.out"

# Write backend-specific prompts to the prompt files.

phone-a-friend \
  --to codex \
  --repo "$PWD" \
  --prompt "$(cat "$CODEX_PROMPT")" \
  --sandbox <sandbox> \
  --timeout 600 \
  --no-stream \
  --fast \
  --no-include-diff \      # or --include-diff if user asked for diff/branch/staged review
  > "$CODEX_OUT" 2>&1 &
PID_CODEX=$!

phone-a-friend \
  --to gemini \
  --repo "$PWD" \
  --prompt "$(cat "$GEMINI_PROMPT")" \
  --sandbox <sandbox> \
  --timeout 600 \
  --no-stream \
  --fast \
  [--model <model>] \
  --no-include-diff \      # or --include-diff if user asked for diff/branch/staged review
  > "$GEMINI_OUT" 2>&1 &
PID_GEMINI=$!

wait "$PID_CODEX"
CODEX_STATUS=$?

wait "$PID_GEMINI"
GEMINI_STATUS=$?
```

Then read both output files. Do not stop just because one backend failed; use
the successful output and clearly report the failure.

## Review And Iterate

After each round, evaluate the outputs:

- Did the task get answered?
- Do outputs agree on the main recommendation?
- Are important risks or missing assumptions still unresolved?
- Is another round likely to improve the result?

Stop early if:

- There is a clear complete answer.
- Both backends agree and no material risks remain.
- All requested acceptance criteria are met.

Continue if:

- Backends disagree materially.
- One backend identifies a serious risk the other missed.
- The output is incomplete or too vague.
- The user asked for multiple rounds.

Never exceed `MAX_ROUNDS`.

## Conflict Resolution For `both`

When Codex and Gemini disagree:

1. Identify the exact disagreement.
2. Decide whether the disagreement is factual, architectural, or preference.
3. If another round remains, send each backend a prompt containing the other
   backend's relevant claim and ask it to respond specifically.
4. If no rounds remain, present the disagreement honestly instead of forcing a
   false consensus.

## Final Synthesis

Return:

```text
Summary:
<what was accomplished>

Backends:
<backend list and whether each succeeded>

Rounds:
<completed rounds> of <MAX_ROUNDS>

Result:
<final recommendation or answer>

Important caveats:
<remaining risks, if any>

Next steps:
<concrete actions>
```

If one or more backend commands failed, include the command status and the
most relevant error lines.

## Gemini Notes

If using Gemini and the user did not provide `--model`, prefer:

```bash
--model gemini-2.5-flash
```

If Gemini returns a transient capacity error, retry once with
`gemini-2.5-flash-lite`. Do not use interactive Gemini auto-routing in
headless command execution.

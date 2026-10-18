---
name: phone-a-team
description: "Iterative multi-model refinement from inside Grok. Runs parallel phone-a-friend relays across rounds, with Grok synthesizing the replies. Use for a team discussion that should converge, rather than a one-shot second opinion."
argument-hint: '<task description> [--backend <name>[,<name>,...]] [--max-rounds N] [--model <name>]'
---

# /phone-a-team for Grok

Orchestrate a Bash round loop in the current conversation. Grok reads the
friends' replies and synthesizes between rounds. Do not spawn subagents or
use Agent Teams. For a single parallel consultation, use `/phone-a-friend`.

## Inputs and preflight

Read the task and options from the user's request after the skill text (or
`$ARGUMENTS` when the host supplies it). Preserve the full task in the first
round's prompt, including scope and instructions not to edit files.

- `--backend a,b`: unique friend names from `antigravity`, `claude`, `codex`,
  `gemini`, `opencode`, `pi`, `ollama`. Default: `claude,gemini`.
  Never select `grok`, including through a direct CLI fallback. Reject an
  invalid backend before running anything. A single friend is valid.
- `--max-rounds N`: positive integer, default 3, capped at 5.
- `--model NAME`: optional model override for `ollama` and `opencode` only.

Use Bash for the following blocks, keeping their variables in the same
session. Resolve `RELAY_BIN` with `command -v phone-a-friend`; if missing,
report how to install it and stop. Do not substitute `./phone-a-friend`.
Resolve `REPO` with `git rev-parse --show-toplevel` or the current directory.
Keep PaF's read-only sandbox and do not escalate permissions on failure.

Set `BACKENDS` to the validated comma-separated list. Set `TASK_DESCRIPTION`
as data through a safely quoted assignment or file, never as shell code.
Do the same for later synthesis text. Do not use `eval` or interpolate user
content into an executable command string.

## Run a round

Create a unique team ID and reuse `${TEAM_ID}-${BACKEND}` as each friend's
session label for every round. All allowed friends support PaF sessions.

```bash
ROUND_DIR="$(mktemp -d "${TMPDIR:-/tmp}/paf-team.XXXXXXXX")"
TEAM_ID="paf-team-$(basename "$ROUND_DIR")"
ROUND=1
ROUND_PROMPT="$ROUND_DIR/r${ROUND}-prompt.txt"
printf '%s\n\n%s\n' \
  'Review this task as a panel member. Be specific; challenge assumptions and name unresolved risks. Do not edit files.' \
  "$TASK_DESCRIPTION" > "$ROUND_PROMPT"
```

Run this block once per round, then return to Grok's synthesis step. Do not
automatically run all rounds without reading and synthesizing the replies.

```bash
PIDS=()
for BACKEND in ${BACKENDS//,/ }; do
  MODEL_ARGS=()
  if [[ -n "${MODEL:-}" && ( "$BACKEND" == ollama || "$BACKEND" == opencode ) ]]; then
    MODEL_ARGS=(--model "$MODEL")
  fi
  (
    if PHONE_A_FRIEND_HOST=grok PHONE_A_FRIEND_INCLUDE_DIFF=false \
      "$RELAY_BIN" --to "$BACKEND" --repo "$REPO" \
        --prompt "$(cat "$ROUND_PROMPT")" --session "${TEAM_ID}-${BACKEND}" \
        --timeout 180 --no-stream --no-include-diff --sandbox read-only \
        "${MODEL_ARGS[@]}" \
        > "$ROUND_DIR/r${ROUND}-${BACKEND}.out" \
        2> "$ROUND_DIR/r${ROUND}-${BACKEND}.err"; then
      printf '0\n' > "$ROUND_DIR/r${ROUND}-${BACKEND}.status"
    else
      printf '%s\n' "$?" > "$ROUND_DIR/r${ROUND}-${BACKEND}.status"
    fi
  ) &
  PIDS+=("$!")
done
for PID in "${PIDS[@]}"; do wait "$PID"; done
```

Keep local file contents out of relay payloads unless the user explicitly
authorized sending them. Pass the repo path so tool-capable friends can read
it themselves. Ollama has no file access: limit its prompt to the task and
authorized context. Do not attach a diff unless the user requested that
review scope. Never read or send credentials or `.env` contents.

## Synthesize and continue

Read each status file and answer. Stderr includes normal progress and
receipts; non-empty stderr alone does not mean failure. For a nonzero exit,
report the backend and relevant error with credentials redacted. Never
treat partial failed output as a successful vote. Do not retry auth errors.
If needed, use `"$RELAY_BIN" doctor --json` to check executable identity.

Grok produces a short synthesis naming agreement, disagreements with their
authors, and concrete unresolved issues. Choose:

- **SHIP**: sufficient agreement, no unresolved blockers. Stop.
- **ITERATE**: another round could resolve specific questions. Continue only
  below the round cap; otherwise report the remaining disagreement.
- **ABSTAIN**: no usable replies, or missing friends prevent satisfying the
  request. Stop and report what failed.

If continuing, increment `ROUND`, write the synthesis and focused follow-up
questions to a new `ROUND_PROMPT` using `printf '%s\n' "$SYNTHESIS_TEXT"`,
and repeat the parallel block with the same session labels. Retain the
original constraints in the follow-up. Continue with working friends only
when doing so still meets the user's request, and disclose any omissions.

Finish with the verdict, round count, final synthesis, a compact per-backend
status table, and `TEAM_ID` for inspecting the sessions later. Temporary
round files can be removed after the results have been read and presented.

Every relay must carry `PHONE_A_FRIEND_HOST=grok`. Never call `--to grok`.

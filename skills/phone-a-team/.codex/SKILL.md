---
name: phone-a-team
description: "Iterative multi-model refinement from inside Codex. Runs N rounds of parallel relays through phone-a-friend to friend backends (Claude, Gemini, OpenCode, Ollama), synthesizes between rounds, and converges on a final answer. No subagent spawn, no Agent Teams primitive: pure Bash orchestration plus the model's own synthesis."
argument-hint: '<task description> [--backend <name>[,<name>,...]] [--max-rounds N] [--model <name>]'
---

# /phone-a-team for Codex

Iterative multi-model refinement loop. Use this when the user wants more than a single relay — they want backends to push back on each other across rounds and converge on something. For one-shot "ask X and Y" requests, use `/phone-a-friend` (which already supports parallel multi-backend) instead.

You orchestrate the rounds yourself via Bash. Do not spawn Codex subagents for this — the skill is designed to run end-to-end in the parent turn. Codex's own model does the synthesis between rounds by reading the per-backend outputs you write to disk.

## Inputs

`$ARGUMENTS` contains the user's request. Parse:

- **TASK_DESCRIPTION**: free-form text with flags stripped.
- **`--backend <name>`** (or `--backend a,b`): comma-separated list of friend backends to query each round. Allowed: `claude`, `gemini`, `opencode`, `ollama`. **Never** `codex` (the recursion guard refuses; you would be calling yourself). Default: `claude,gemini`.
- **`--max-rounds N`**: rounds before giving up. Clamp to [1, 5]. Default: 3.
- **`--model <name>`**: only meaningful for `ollama` and `opencode`.

If the user named only one backend, the team degenerates to a self-review loop against that backend across rounds. That is valid; do not error out, just proceed.

## Step 0 — Preflight

1. Resolve the binary. **Always** use the PATH-installed phone-a-friend, never `./phone-a-friend` from the current directory.

   ```bash
   RELAY_BIN="$(command -v phone-a-friend)"
   if [ -z "$RELAY_BIN" ]; then
     echo "phone-a-friend binary not on PATH. Install with: npm i -g @freibergergarcia/phone-a-friend" >&2
     exit 1
   fi
   ```

2. Resolve the repository path.

   ```bash
   REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
   ```

3. **Check the Codex sandbox mode.** You are running inside Codex. By default, Codex uses `workspace-write`, which **blocks subprocess access to the macOS Keychain and most outbound network**. That means relays to Claude will return `Not logged in · Please run /login` (false alarm — Claude is logged in; the sandbox is intercepting) and relays to Gemini will hang until the timeout fires (Gemini cannot reach Google for OAuth refresh).

   Before starting round 1, tell the user:

   > /phone-a-team will spawn parallel relays to ${BACKENDS}. Codex's default sandbox blocks the keychain and OAuth refresh paths these CLIs need. For best results, restart Codex with `codex --sandbox danger-full-access` (or `--full-auto`). Alternatively, export `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` in your shell before launching Codex — the API-key path skips OAuth entirely.

   If the user has already opened up the sandbox (or set the API keys), proceed. Otherwise it is reasonable to abort the team run upfront — running it would either burn the per-round timeout on every backend (Gemini hang) or surface a misleading "Not logged in" (Claude). Both are bad UX.

## Step 1 — Mint a team ID + per-backend session labels

Stable across rounds so the friend backends resume their prior context per round instead of re-receiving the full task description every time.

```bash
TASK_SLUG="$(echo "$TASK_DESCRIPTION" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | awk '{print $1"-"$2"-"$3}')"
RAND4="$(head -c 16 /dev/urandom | xxd -p | head -c 4)"
TEAM_ID="paf-team-${TASK_SLUG}-${RAND4}"
```

For each backend in the comma-separated list, the session label is `${TEAM_ID}-<backend>`. Reuse that exact label across every round so the backend continues its thread.

| Backend | resumeStrategy | Pass `--session`? |
|---|---|---|
| claude | native-session | yes |
| codex | native-session | yes (never used here; recursion guard) |
| opencode | native-session | yes |
| ollama | transcript-replay | yes |
| gemini | unsupported | **no, omit the flag entirely** |

Build the relay flag accordingly per backend:

```bash
session_flag_for() {
  local b="$1"
  if [ "$b" = "gemini" ]; then
    echo ""
  else
    echo "--session ${TEAM_ID}-${b}"
  fi
}
```

## Step 2 — Round 1: parallel initial pass

Write the round prompt to a temp file, then fan out to every backend in the background.

```bash
ROUND_DIR="$(mktemp -d)"
trap 'rm -rf "$ROUND_DIR"' EXIT

ROUND=1
ROUND_PROMPT="$ROUND_DIR/r${ROUND}-prompt.txt"

cat > "$ROUND_PROMPT" <<'PAF_TEAM_EOF'
You are one member of a small panel reviewing this task. Be specific and actionable. Push back where you disagree with assumptions; flag risks even if they are not blockers. If you have nothing to add, say so directly rather than padding.

Task:
${TASK_DESCRIPTION}
PAF_TEAM_EOF

for BACKEND in $(echo "$BACKENDS" | tr ',' ' '); do
  PHONE_A_FRIEND_HOST=codex PHONE_A_FRIEND_INCLUDE_DIFF=false \
    "$RELAY_BIN" --to "$BACKEND" --repo "$REPO" \
      --prompt "$(cat "$ROUND_PROMPT")" \
      $(session_flag_for "$BACKEND") \
      --timeout 180 --no-stream --no-include-diff \
      > "$ROUND_DIR/r${ROUND}-${BACKEND}.out" 2> "$ROUND_DIR/r${ROUND}-${BACKEND}.err" &
done
wait
```

Use single-quoted heredocs (`<<'PAF_TEAM_EOF'`) so user-supplied text cannot break shell quoting. Substitute `${TASK_DESCRIPTION}` from your shell env before writing the file (the safer pattern is `printf` + `sed` to assemble the file rather than relying on heredoc expansion).

`--timeout 180` is a per-round upper bound. A 3-minute hang is generous for a single relay; if a backend has not produced anything in that window it is functionally stalled. Adjust upward only when the task genuinely takes longer (e.g., a deep code review).

## Step 3 — Synthesize the round

Read every `r${ROUND}-${BACKEND}.out` file. **You** (the Codex model running this skill) produce the synthesis directly in your next response. Do not shell out for this; you already have all the context.

Synthesis shape:

```
### Round ${ROUND} synthesis
**Convergence**: one paragraph naming points the backends agree on.
**Divergence**: one paragraph naming where they disagreed (and which backend said which side).
**Unresolved**: bulleted list of concrete questions or risks still open.
**Verdict**: one of SHIP, ITERATE, ABSTAIN.
  - SHIP: backends converged, no blockers, no further iteration needed.
  - ITERATE: at least one important point unresolved; another round may help.
  - ABSTAIN: no backend produced actionable content (auth failures, timeouts, refusals). Stop and tell the user.
```

If a backend's `.err` file is non-empty (auth failure, timeout, refusal), include that in the synthesis verbatim — do not silently drop the backend. Cap the synthesis at ~200 words; the user reads it.

## Step 4 — Iterate or stop

| Verdict | Round count | Action |
|---|---|---|
| SHIP | any | Stop. Final output is the round-N synthesis plus the strongest verbatim quote from the converging backends. |
| ABSTAIN | any | Stop. Surface what failed so the user can fix it (re-auth, network, etc.). |
| ITERATE | < MAX | Build the round-N+1 prompt: a short "here is the panel's synthesis of round N; refine your prior reply" delta. Same parallel-fan-out pattern, same session labels (the backends resume their thread, so only the delta is needed). |
| ITERATE | = MAX | Stop. Report that the team hit the round cap without convergence; include the final synthesis so the user sees the state. |

Round N+1 prompt template:

```bash
NEXT=$((ROUND + 1))
DELTA_PROMPT="$ROUND_DIR/r${NEXT}-prompt.txt"

cat > "$DELTA_PROMPT" <<'PAF_TEAM_EOF'
Round ${NEXT}. Below is the panel's synthesis of the previous round. Refine your prior response: keep what holds, change what does not. If you stand by your prior position, say so explicitly and explain why.

${SYNTHESIS_TEXT}
PAF_TEAM_EOF
```

Then re-run the parallel relay block from Step 2 with `ROUND=$NEXT` and the new prompt file. Session labels are unchanged.

## Step 5 — Present the final output

Show the user:

1. **Final verdict** (one line): which round converged, which backends ran.
2. **Final synthesis** (the body from the last round).
3. **Backend table** (compact markdown):
   ```
   | Backend | Final answer | Status |
   |---|---|---|
   | Claude | <one-line summary> | converged |
   | Gemini | <one-line summary> | converged |
   ```
4. **Team ID** so the user can later inspect or clean up sessions via `phone-a-friend session list` / `session prune`.

## Hard rules

- Never select `--to codex`. The recursion guard refuses, and you would be calling yourself.
- Always use `$RELAY_BIN` from `command -v phone-a-friend`. Never `./phone-a-friend`.
- Reuse the SAME session label per backend across rounds. That is what makes the friend backend remember.
- Single-quoted heredocs for any user-supplied text or untrusted content.
- Per-round `--timeout 180`. Do not omit the timeout flag; a single hung backend should not block the team.
- Run all backends per round in parallel (`&` + `wait`). Never sequentially.
- Do not retry a backend that returned an auth error. Surface the error in the synthesis and let the user fix it.
- Always set `PHONE_A_FRIEND_HOST=codex` and `PHONE_A_FRIEND_INCLUDE_DIFF=false` on every relay invocation so the recursion marker is set and diffs are suppressed by default.

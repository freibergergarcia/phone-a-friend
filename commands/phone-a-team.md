---
name: phone-a-team
description: Iterative refinement — delegates tasks to backend(s) via agent teams, reviews, iterates up to MAX_ROUNDS rounds, synthesizes result.
argument-hint: <task description> [--backend codex|gemini|both] [--max-rounds N]
---

# /phone-a-team

Autonomous iterative refinement loop. Delegate a task to one or more backends,
review the output, iterate with feedback, and synthesize the final result.

## Goal

Take a task description, relay it to backend(s) via `phone-a-friend`, review
the output, iterate up to MAX_ROUNDS rounds until convergence, then present a
synthesized result to the user.

## Inputs

- Task description and options: `$ARGUMENTS`

## Step 1 — Parse Arguments

Extract the `--backend` flag, `--max-rounds` flag, and task description from
`$ARGUMENTS`.

### Backend parsing

- If `$ARGUMENTS` contains `--backend codex`: set BACKEND = `codex`
- If `$ARGUMENTS` contains `--backend gemini`: set BACKEND = `gemini`
- If `$ARGUMENTS` contains `--backend both`: set BACKEND = `both`
- If no `--backend` flag is present: set BACKEND = `codex` (default)
- If `--backend` is present but the value is not `codex`, `gemini`, or `both`:
  report an error and stop. Valid values: `codex`, `gemini`, `both`.

### Max rounds parsing

- If `$ARGUMENTS` contains `--max-rounds N` (where N is a number): set
  `MAX_ROUNDS = N`, clamped to range [1, 5].
- Else if `$ARGUMENTS` contains natural language like "no more than N
  times", "no more than N rounds", "max N rounds", "up to N iterations",
  or similar: extract N, set `MAX_ROUNDS = N`, clamped to [1, 5]. Only
  extract natural language round caps when the phrase is clearly a
  meta-instruction (not part of the task content). If ambiguous, leave the
  text in TASK_DESCRIPTION and use the default MAX_ROUNDS. For example,
  "review this code, max 2 rounds" → extract 2 (meta-instruction). "Fix the
  loop that runs no more than 4 times" → do NOT extract (task content). When
  in doubt, do not extract. Prefer the explicit `--max-rounds` flag for
  unambiguous round caps.
- If neither is present: set `MAX_ROUNDS = 3` (default).

### Task description

- Everything in `$ARGUMENTS` that is NOT the `--backend <value>` pair or
  `--max-rounds <value>` pair (or the natural language round-cap phrase) is
  the TASK_DESCRIPTION.
- If TASK_DESCRIPTION is empty after parsing, ask the user what task they want
  to work on. Do not proceed until you have a task.

## Step 2 — Preflight Check

Verify that the requested backend(s) are installed and available.

Run these checks using `command -v`:

```bash
command -v codex   # check if codex CLI is available
command -v gemini  # check if gemini CLI is available
```

Apply the following rules:

| BACKEND   | codex available | gemini available | Action                                                    |
|-----------|-----------------|------------------|-----------------------------------------------------------|
| `codex`   | yes             | —                | Proceed normally                                          |
| `codex`   | no              | —                | **Abort.** Tell user: "codex CLI not found. Install: `npm install -g @openai/codex`" |
| `gemini`  | —               | yes              | Proceed normally                                          |
| `gemini`  | —               | no               | **Abort.** Tell user: "gemini CLI not found. Install: `npm install -g @google/gemini-cli`" |
| `both`    | yes             | yes              | Proceed with both backends                                |
| `both`    | yes             | no               | **Degrade** to codex only. Warn: "gemini not available, proceeding with codex only" |
| `both`    | no              | yes              | **Degrade** to gemini only. Warn: "codex not available, proceeding with gemini only" |
| `both`    | no              | no               | **Abort.** Tell user: "No backends available. Install at least one: `npm install -g @openai/codex` or `npm install -g @google/gemini-cli`" |

After degradation, update BACKEND to the single available backend and continue.

## Step 3 — Create Agent Team

Create an agent team and spawn worker teammate(s) for relay delegation.

### State Variables

Set these during this step. They are referenced throughout the rest of the
command:

- `TEAM_ACTIVE` = true | false
- `TEAM_NAME` = string (if team created)
- `WORKERS` = list of teammate names (if team created)

### Algorithm

1. **Create team.** Call `TeamCreate` with
   `team_name: "phone-a-team-<task-slug>"` where `<task-slug>` is a short
   kebab-case slug derived from the first few words of TASK_DESCRIPTION
   (e.g., "review-error-handling", "design-architecture-docs").
   Team creation may fail if agent teams are not available in the current
   environment (e.g., env var not set, feature disabled). This is expected;
   if it fails → set `TEAM_ACTIVE=false`, skip to end of step.

2. **Spawn teammate(s)** based on BACKEND:
   - **Single backend** (`codex` or `gemini`): Spawn 1 teammate named
     `relay-worker` via the `Task` tool with:
     - `team_name`: the TEAM_NAME from step 1
     - `subagent_type: "general-purpose"`
     - `mode: "bypassPermissions"`
   - **Both backends**: Spawn 2 teammates **in parallel**:
     - `codex-worker` (same params as above)
     - `gemini-worker` (same params as above)

3. **Each teammate's prompt** must include:
   - Their assigned backend (`--to codex` or `--to gemini`)
   - The relay command template:
     ```
     ./phone-a-friend --to <backend> --repo "$PWD" --prompt "<prompt>" [--context-text "<context>"] [--include-diff] [--sandbox <mode>]
     ```
   - Instructions to:
     - Run relay calls as messaged by the lead
     - Send results back via `SendMessage`
     - Mark tasks complete via `TaskUpdate`

4. **Seed first task immediately** after spawning — send the Round 1 task
   to the worker(s) via `SendMessage`. Do NOT just say "wait for tasks" or
   "stand by" — this causes deadlock.

5. **If any spawn fails**: Send `shutdown_request` to any already-spawned
   teammates, call `TeamDelete`, set `TEAM_ACTIVE=false`.

6. Set `WORKERS` to the list of successfully spawned teammate names.

### Fallback

If `TEAM_ACTIVE=false` (team creation or spawning failed), all relay calls
in Step 4 run directly via Bash in the current session. The loop behavior
is identical — only the execution mechanism changes.

## Step 4 — Iterative Loop (Max MAX_ROUNDS Rounds)

Execute a do-review-decide loop. Maximum MAX_ROUNDS rounds. Stop early if
converged.

### Execution Mode

Before executing any round, select the execution mode based on team state:

**With team (`TEAM_ACTIVE=true`):**
- **DO phase**: Lead sends task to teammate(s) via `SendMessage`. For
  `--backend both`, message both workers in parallel. Wait for results.
  If a worker does not respond within the relay timeout (default 600
  seconds) plus 30 seconds, set `TEAM_ACTIVE=false`, send
  `shutdown_request` to all workers, call `TeamDelete`, and degrade to
  direct Bash mode for the remainder of the loop.
- **REVIEW phase**: Lead reviews output received from teammate(s). For
  `--backend both`, resolve conflicts (see "Backend Both — Conflict
  Resolution" below).
- **DECIDE phase**: If next round is needed, send specific feedback to
  teammate(s) via `SendMessage`.

**Without team (`TEAM_ACTIVE=false`):**
- **DO phase**: Lead runs `./phone-a-friend` relay calls directly via Bash.
  For `--backend both`, run sequentially.
- **REVIEW/DECIDE phases**: Same as above.

### Round Structure

Each round has three phases:

#### Phase 1: DO

Delegate the task to the backend via the relay. The lead's job is to
**orchestrate**, not to do the backend's work.

- **Single backend**: Relay the task (or sub-task) via phone-a-friend:
  ```bash
  ./phone-a-friend --to <backend> --repo "$PWD" --prompt "<prompt>" [--context-text "<context>"] [--include-diff] [--sandbox <mode>]
  ```
- **Both backends**: Relay to each backend (in parallel if using teams,
  sequentially otherwise). You may give them the same task or different
  sub-tasks.

#### Phase 2: REVIEW

Evaluate the output against the convergence rubric. ALL items must pass:

1. **Acceptance criteria met?** — Does the output accomplish the task as
   described? Is the core request fulfilled?
2. **No critical risks or correctness issues?** — Is the output free of bugs,
   security issues, logical errors, and significant omissions?
3. **Validation done?** — Has the output been checked (tests run, code
   reviewed, logic verified)? If validation was explicitly skipped, is there
   a documented reason?

**Multi-artifact convergence rule**: If the task produces multiple
deliverables (e.g., 5 architecture docs, 3 API endpoints), require explicit
per-deliverable critique before allowing convergence. A blanket "looks good"
is NOT sufficient — each deliverable must be individually evaluated against
the rubric.

**Round 1 convergence guard**: If the task description suggests significant
complexity (multiple files, design work, refactoring, multi-step
implementation), require at least a brief critique of each major output
before declaring convergence. This prevents superficial "converged in
round 1" on tasks that deserve iteration.

**Backend both — conflict resolution**:
- If both backends agree → stronger convergence signal; note agreement in
  synthesis.
- If they conflict → evaluate each against the rubric independently, select
  the better output, note the disagreement and rationale for selection.
- If one backend fails → continue with the successful one, note the failure.

#### Phase 3: DECIDE

Based on the review:

- **Converged** (all rubric items pass): Stop the loop. Execute Step 8
  (Cleanup), then Step 9 (Final Synthesis). Do not iterate further — no
  iterating for its own sake.
- **Issues found** (one or more rubric items fail): Formulate specific,
  actionable feedback. Start the next round with this feedback incorporated
  into the prompt.
- **Backend error** (timeout, crash, unexpected failure): Note the failure.
  If another backend is available, try it. If no backend produced a
  successful result this round: if a previous round had a usable result,
  stop the loop and synthesize using that result. If no round has produced
  a usable result, stop the loop and synthesize a failure summary. For
  timeouts specifically, retry the backend in the next round (matching the
  failure table). Only stop the loop on non-timeout failures when no backend
  produced a result.
- **Rate limited (429)**: Skip this backend for the current round. Retry it
  in the next round. If using both backends, continue with the other.

### Round Progression Example

```
Round 1: Delegate task → Review output → Issues found → next round
Round 2: Send revision prompt with feedback → Review → Nearly there → next round
Round 3: Final polish request → Review → Converged ✅ → Cleanup → Synthesis
```

Or:

```
Round 1: Delegate task → Review output → Converged ✅ → Cleanup → Synthesis
```

Both are valid. Stop as soon as convergence is reached.

### Final Round Forced Stop

If the loop reaches the end of round MAX_ROUNDS without convergence, STOP.
Do not continue to another round. Execute Step 8 (Cleanup), then Step 9
(Final Synthesis) with:
- The best result produced so far
- An explicit list of unresolved items or remaining issues

## Step 5 — Context Budget

To avoid hitting relay size limits and to keep prompts focused:

**Delegate-first rule**: Before the first relay call, do NOT read the entire
codebase. Read at most 2-3 files for preflight context. The backend has
`--repo` access and can read files itself. The lead's job is to orchestrate,
not to become an expert on the codebase before delegating.

**Per-round relay rules**:
- Each relay call sends ONLY:
  - The original TASK_DESCRIPTION
  - The latest output or delta from the previous round
  - A 2-3 sentence summary of prior rounds (if referencing them)
- Do NOT send the full conversation history or all prior round outputs.
- Do NOT accumulate context across rounds. Each round starts fresh with
  task + latest state + brief summary.

## Step 6 — Sandbox Policy

Relay calls default to `--sandbox read-only`, but MUST escalate when the
task requires writes.

**Rules:**
- If the task asks to **create or modify files** (e.g., "create .md files
  under /architecture", "refactor the backend", "apply these changes"),
  the relay call MUST use `--sandbox workspace-write` so the backend writes
  the files directly.
- The lead should only review and synthesize — not re-create what the
  backend already produced. The backend does the writing; the lead does
  the reviewing.
- If the backend produces content in read-only mode (returns text rather
  than writing files), the lead MAY write files as a fallback, but this
  should be the exception, not the default.
- When escalating sandbox permissions, note it in the final synthesis so the
  user is aware that write operations were performed.

## Step 7 — Backend Failure Handling

Reference table for handling backend failures during the loop:

| Scenario                               | Action                                            |
|----------------------------------------|---------------------------------------------------|
| Single backend requested, available    | Normal operation                                  |
| Single backend requested, missing      | Abort with install hint (handled in Step 2)       |
| Both requested, one missing            | Degrade to available (handled in Step 2)          |
| Both requested, one fails mid-loop     | Continue with remaining backend, note failure     |
| Both requested, both fail mid-loop     | Stop loop. Synthesize using best prior result, or failure summary if no prior result exists |
| Backend rate-limited (429)             | Skip for this round, retry next round             |
| Backend timeout                        | Treat as failure for this round, retry next       |

If all backends are unavailable or failing, stop the loop and move to
synthesis with whatever results have been collected. Always explain what
happened in the synthesis.

## Step 8 — Cleanup

**ALWAYS execute this step if a team was created (i.e., `TeamCreate`
succeeded at any point during this session)**, regardless of how the loop
ended (convergence, forced stop, abort, error, or user interruption).
**Execute cleanup BEFORE presenting the final synthesis** so that teams are
never left orphaned if the session ends after synthesis.

1. Send `shutdown_request` to each teammate in WORKERS.
2. Wait up to 30 seconds for shutdown confirmations.
3. Call `TeamDelete` to remove the team and its task list.

If a teammate does not respond to the shutdown request within 30 seconds,
proceed with `TeamDelete` anyway. Do not leave orphaned teams.

## Step 9 — Final Synthesis

When the loop ends (converged, forced stop, or backend-failure stop), present
a clear synthesis to the user. Include ALL of the following:

1. **What was accomplished**: Summary of the result — what was done, what
   changed, what was produced.
2. **Which backend(s) contributed**: List which backends were called and what
   each contributed.
3. **How many rounds**: State the number of rounds executed (e.g., "Converged
   in 2 rounds" or "Forced stop after MAX_ROUNDS rounds").
4. **Convergence status**:
   - If converged: state that all rubric items passed.
   - If forced stop: list the specific unresolved items that prevented
     convergence.
5. **Sandbox note**: If `--sandbox workspace-write` was used at any point,
   note it here.

Format the synthesis clearly. The user should understand at a glance what
happened and whether the result is complete.

## Constraints

- **Max MAX_ROUNDS rounds.** Never exceed MAX_ROUNDS rounds regardless of
  convergence status. Default is 3, user can set 1-5 via `--max-rounds`.
- **No nesting.** Do not invoke `/phone-a-team` from within a `/phone-a-team`
  session. This command is not re-entrant.
- **One team per session.** Only one team can be active. Do not attempt to
  create multiple teams.
- **Teammates use bypassPermissions.** All spawned teammates MUST use
  `mode: "bypassPermissions"` to avoid blocking the user with permission
  prompts.
- **Context size limits.** Respect the relay limits: 200 KB context, 300 KB
  diff, 500 KB prompt. Use the context budget rules in Step 5.
- **No changes to phone-a-friend internals.** This command uses
  `phone-a-friend` as a black box. Do not modify relay.py, backends/, or
  cli.py.
- **Cleanup is mandatory.** Step 8 must execute if a team was created (i.e.,
  `TeamCreate` succeeded at any point during this session), even on error
  paths.

## Notes

- This is a prompt-only feature. All behavioral rules are best-effort prompt
  policy. There is no runtime enforcement of the loop contract or round limits.
- Token usage is higher than a single `/phone-a-friend` call. Each round
  involves at least one relay call plus review overhead.
- For simple one-shot reviews, use `/phone-a-friend` instead. Use
  `/phone-a-team` when you want iterative refinement and convergence checking.

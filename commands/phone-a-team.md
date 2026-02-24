---
name: phone-a-team
description: Iterative refinement — delegates tasks to backend(s) via agent teams, reviews, iterates up to MAX_ROUNDS rounds, synthesizes result.
argument-hint: <task description> [--backend codex|gemini|ollama|both] [--max-rounds N] [--model <name>]
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
- If `$ARGUMENTS` contains `--backend ollama`: set BACKEND = `ollama`
- If `$ARGUMENTS` contains `--backend both`: set BACKEND = `both`
- If no `--backend` flag is present: set BACKEND = `codex` (default)
- If `--backend` is present but the value is not `codex`, `gemini`, `ollama`,
  or `both`: report an error and stop. Valid values: `codex`, `gemini`,
  `ollama`, `both`.

Note: `both` means `codex + gemini` (the two CLI backends). Ollama is a
separate single-backend option. To use all three, run separate sessions.

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

### Model override parsing

Extract a model name from the task arguments.

**Explicit flag (highest priority, all backends):**
- If `$ARGUMENTS` contains `--model <name>`: set `MODEL_OVERRIDE = <name>`.
  Remove the `--model <name>` pair from TASK_DESCRIPTION.
- This applies to all backends (codex, gemini, ollama, both).

**Natural language extraction (Ollama only, lower priority):**
- Only attempt NL extraction when BACKEND is exactly `ollama` and no
  `--model` flag was found.
- Do NOT attempt NL extraction for `codex`, `gemini`, or `both` backends.
- Look for patterns: "use <name>", "with <name> model", "using <name>",
  "via <name>", "the <name> model".
- Only extract when the phrase is clearly a meta-instruction about which
  model to use, not part of the task content itself.
- If multiple candidate models are found, do not guess — leave in
  TASK_DESCRIPTION.
- If the candidate appears inside quotes, backticks, or code blocks, do
  NOT extract (it's an example or reference, not a meta-instruction).

**Examples:**
- "review this code, use deepseek" (backend=ollama) → extract "deepseek" ✓
- "analyze using qwen3-coder" (backend=ollama) → extract "qwen3-coder" ✓
- "debug the deepseek integration" → do NOT extract (task content) ✗
- "Fix the domain model" → do NOT extract ("model" is task content) ✗
- "Compare qwen3 vs llama3" → do NOT extract (multiple candidates) ✗
- "Write docs showing --model qwen3 usage" → do NOT extract (inside example) ✗
- "use deepseek" (backend=both) → do NOT extract (NL only for ollama) ✗
- When in doubt, do not extract.

### Task description

- Everything in `$ARGUMENTS` that is NOT the `--backend <value>` pair,
  `--max-rounds <value>` pair, `--model <value>` pair, (or the natural
  language round-cap/model phrase) is the TASK_DESCRIPTION.
- If TASK_DESCRIPTION is empty after parsing, ask the user what task they want
  to work on. Do not proceed until you have a task.

## Step 2 — Preflight Check

Verify that the requested backend(s) are installed and available.

### CLI backends (codex, gemini)

Run these checks using `command -v`:

```bash
command -v codex   # check if codex CLI is available
command -v gemini  # check if gemini CLI is available
```

### Ollama backend

Ollama is an HTTP backend — the local binary is optional. Check server
reachability **and discover available models**:

```bash
curl -sf http://localhost:11434/api/tags
# Or if OLLAMA_HOST is set: curl -sf "$OLLAMA_HOST/api/tags"
```

Parse the JSON response to extract model names from the `models[].name`
array. Store the list as `OLLAMA_AVAILABLE_MODELS` and select a model as
`OLLAMA_SELECTED_MODEL` using this logic:

**Model selection (precedence order):**

**First, check for empty models — this takes priority over all selection
rules.** If `OLLAMA_AVAILABLE_MODELS` is empty (server running but no models
pulled): **Abort**, even if `MODEL_OVERRIDE` or config specifies a model.
Tell user: "Ollama server is running but has no models pulled. Install one
with: `ollama pull <model-name>`". Rationale: an empty model list means the
server has nothing to run — proceeding would always fail.

If models are available, select using this precedence:
1. If `MODEL_OVERRIDE` is set (from `--model` flag or NL extraction in
   Step 1): set `OLLAMA_SELECTED_MODEL = MODEL_OVERRIDE`. Check if it exists
   in `OLLAMA_AVAILABLE_MODELS`. If not found, **warn** (e.g., "Model 'foo'
   not found in local models: [bar, baz]. Proceeding anyway — it may be a
   tag variant.") but proceed.
2. If no override, check config: run
   `./phone-a-friend config get backends.ollama.model`. If a value is
   returned, set `OLLAMA_SELECTED_MODEL` to that value. Validate against
   `OLLAMA_AVAILABLE_MODELS` — warn if not found but proceed.
3. If neither override nor config: set `OLLAMA_SELECTED_MODEL` to the first
   model in `OLLAMA_AVAILABLE_MODELS`.

Report the selected model to the user: "Ollama: using model `<name>`"

### Decision table

| BACKEND   | codex available | gemini available | ollama reachable | ollama models | Action                                                    |
|-----------|-----------------|------------------|------------------|---------------|-----------------------------------------------------------|
| `codex`   | yes             | —                | —                | —             | Proceed normally                                          |
| `codex`   | no              | —                | —                | —             | **Abort.** Tell user: "codex CLI not found. Install: `npm install -g @openai/codex`" |
| `gemini`  | —               | yes              | —                | —             | Proceed normally                                          |
| `gemini`  | —               | no               | —                | —             | **Abort.** Tell user: "gemini CLI not found. Install: `npm install -g @google/gemini-cli`" |
| `ollama`  | —               | —                | yes              | > 0           | Proceed with auto-selected model                          |
| `ollama`  | —               | —                | yes              | 0             | **Abort.** Tell user: "Ollama is running but has no models. Run: `ollama pull <model-name>`" |
| `ollama`  | —               | —                | no               | —             | **Abort.** Tell user: "Ollama server not reachable at `localhost:11434` (or `$OLLAMA_HOST`). Is Ollama running? Install: https://ollama.com/download" |
| `both`    | yes             | yes              | —                | —             | Proceed with both backends                                |
| `both`    | yes             | no               | —                | —             | **Degrade** to codex only. Warn: "gemini not available, proceeding with codex only" |
| `both`    | no              | yes              | —                | —             | **Degrade** to gemini only. Warn: "codex not available, proceeding with gemini only" |
| `both`    | no              | no               | —                | —             | **Abort.** Tell user: "No backends available. Install at least one: `npm install -g @openai/codex` or `npm install -g @google/gemini-cli`" |

After degradation, update BACKEND to the single available backend and continue.

## Step 3 — Create Agent Team

Create an agent team and spawn worker teammate(s) for relay delegation.

### State Variables

Set these during this step. They are referenced throughout the rest of the
command:

- `TEAM_ACTIVE` = true | false
- `TEAM_NAME` = string (if team created)
- `WORKERS` = list of teammate names (if team created)
- `OLLAMA_SELECTED_MODEL` = string (set during Step 2 preflight if Ollama
  is a requested backend; used in all Ollama relay calls)

### Algorithm

1. **Create team.** Call `TeamCreate` with
   `team_name: "phone-a-team-<task-slug>"` where `<task-slug>` is a short
   kebab-case slug derived from the first few words of TASK_DESCRIPTION
   (e.g., "review-error-handling", "design-architecture-docs").
   Team creation may fail if agent teams are not available in the current
   environment (e.g., env var not set, feature disabled). This is expected;
   if it fails → set `TEAM_ACTIVE=false`, skip to end of step.

2. **Spawn teammate(s)** based on BACKEND. Each teammate MUST have a
   **creative, unique human first name** — never generic labels like
   "relay-worker" or "codex-agent". Draw from diverse cultures and regions,
   invent fresh names each time (never reuse names from recent sessions or
   pick from a fixed list). Announce to the user as **Name** (role / backend),
   e.g. **Leila** (relay / codex), **Tomás** (relay / ollama:qwen3).

   - **Single backend** (`codex`, `gemini`, or `ollama`): Spawn 1 teammate
     via the `Task` tool with:
     - `name`: a creative human first name
     - `team_name`: the TEAM_NAME from step 1
     - `subagent_type: "general-purpose"`
     - `mode: "bypassPermissions"`
   - **Both backends**: Spawn 2 teammates **in parallel**, each with a
     unique human first name (same params as above).

3. **Each teammate's prompt** must use this template:

   ```
   You are a relay worker. Your ONLY job: run the command below via Bash,
   then send the FULL output (not a summary) back to the team lead via
   SendMessage.

   Run this now:

   ./phone-a-friend --to <backend> --repo "$PWD" --prompt "<prompt>" \
     [--context-text "<context>"] [--include-diff] [--sandbox <mode>] \
     [--model <model>]

   After the relay completes, send the FULL unedited output to the team
   lead via SendMessage. Include:
   - The complete relay output (stdout and stderr)
   - Whether the command succeeded or failed (exit code)
   Do NOT summarize, interpret, or editorialize. Send the raw output.

   SHUTDOWN: When you receive a JSON message with "type": "shutdown_request",
   respond using SendMessage with type: "shutdown_response", request_id from
   the message, and approve: true. Do NOT just say "shutting down" in text.
   ```

   Backend-specific additions:
   - For **gemini** workers: always include `--model` per the Gemini Model
     Priority section below.
   - For **ollama** workers: always include `--model` using
     `OLLAMA_SELECTED_MODEL` discovered during preflight (Step 2). Never
     omit `--model` for Ollama — the API returns HTTP 400 when no model is
     specified and no server default is configured.

4. **Seed first task immediately** after spawning — include the Round 1
   relay command directly in the teammate's spawn prompt. Do NOT just say
   "wait for tasks" or "stand by" — this causes deadlock.

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

### Timing Expectations

Different backends have different response times:
- **Codex**: 3-5 minutes for thorough reviews. It reads files one-by-one in
  its sandbox, which is methodical but slow. Do not assume it is stuck.
- **Gemini**: 30-90 seconds typically. Faster but may hit capacity errors.
- **Ollama**: Depends on model size and hardware. Small models (qwen3) are
  fast (10-30s). Large models (llama3.2:70b) can take minutes.

The relay timeout is 600 seconds by default. Do not intervene before that.

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
  ./phone-a-friend --to <backend> --repo "$PWD" --prompt "<prompt>" [--context-text "<context>"] [--include-diff] [--sandbox <mode>] [--model <model>]
  ```
  For gemini, always include `--model` per the Gemini Model Priority section.
  For ollama, always include `--model` using `OLLAMA_SELECTED_MODEL` from preflight.
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
- **Retry-eligible Gemini transient error** (HTTP 429, 499, 500, 503, 504;
  RESOURCE_EXHAUSTED; "high demand"; model not found; transient/timeout):
  try the next model in the priority list before skipping. For codex, skip this
  backend for the current round. Retry in the next round. If using both
  backends, continue with the other.

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
| Ollama server unreachable mid-loop     | Treat as round failure. Retry next round. If still unreachable, stop with failure summary |
| Ollama model not found                 | Treat as round failure (no model fallback for Ollama — user should specify a valid model) |
| Gemini retry-eligible HTTP status (429, 499, 500, 503, 504) | Try next model in priority list first. If all models exhausted, skip for this round, retry next round |
| Backend timeout                        | Gemini: try next model in priority list first. If all models exhausted, treat as failure for this round, retry next |
| Gemini "high demand" / capacity error  | Try next model in priority list. If all exhausted, treat as round failure |
| Gemini model not found                 | Try next model in priority list. If all exhausted, treat as round failure |
| Gemini RESOURCE_EXHAUSTED              | Try next model in priority list. If all exhausted, treat as round failure, retry next round |
| Gemini unclassified error              | Do NOT model-fallback. Treat as round failure immediately |

**Precedence**: For gemini errors, always attempt model fallback **within the
current round** before escalating to round-level retry. Only move to the next
round (or stop) after the model priority list is exhausted.

**Round reset**: Each new round starts again from model #1 in the priority
list. Model fallback state does not carry across rounds.

**Ollama note**: Ollama does not have a model priority list. If a relay call
fails with "model not found", report the error and let the user specify a
different model. Do not attempt automatic model fallback for Ollama.

If all backends are unavailable or failing, stop the loop and move to
synthesis with whatever results have been collected. Always explain what
happened in the synthesis.

## Step 8 — Cleanup

**ALWAYS execute this step if a team was created (i.e., `TeamCreate`
succeeded at any point during this session)**, regardless of how the loop
ended (convergence, forced stop, abort, error, or user interruption).
**Execute cleanup BEFORE presenting the final synthesis** so that teams are
never left orphaned if the session ends after synthesis.

1. Send `shutdown_request` to each teammate in WORKERS via `SendMessage`
   with `type: "shutdown_request"`.
2. Wait up to 30 seconds for `shutdown_response` confirmations (must be
   tool calls, not plain text acknowledgments).
3. If a teammate responds in plain text instead of using the
   `shutdown_response` tool, resend the `shutdown_request` with explicit
   instructions to use `SendMessage` with `type: "shutdown_response"`.
4. Call `TeamDelete` to remove the team and its task list.
5. If `TeamDelete` fails due to active members, do NOT kill tmux panes
   from the lead session (this can kill the lead). Instead, inform the
   user and suggest they manually run: `tmux kill-session -t <name>`

If a teammate does not respond to the shutdown request within 30 seconds
(even after a retry), proceed with `TeamDelete` anyway. Do not leave
orphaned teams.

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
  `phone-a-friend` as a black box. Do not modify its source files.
- **Cleanup is mandatory.** Step 8 must execute if a team was created (i.e.,
  `TeamCreate` succeeded at any point during this session), even on error
  paths.

## Gemini Model Priority

When using `--to gemini` (including the gemini side of `--backend both`),
**always** pass `--model` using the first model from this priority list. Never
use aliases (`auto`, `pro`, `flash`) — use concrete model names only:

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
  NOT model-fallback — treat as immediate round failure

Model fallback happens **within the current round** (see Step 7 precedence
rule). After exhausting all models in a round, escalate to round-level retry
or stop per Step 7. Each new round resets to model #1.

When reporting errors in synthesis, list all attempted models and the error
from each.

This does NOT apply to `--to codex` or `--to ollama`.

## Ollama Model Handling

When using `--to ollama`:

- **Always pass `--model`** in relay calls. Use `OLLAMA_SELECTED_MODEL`
  discovered during preflight (Step 2). Never omit `--model` — the Ollama
  API returns HTTP 400 when no model is specified and no server default is
  configured.

### Model selection precedence

The following precedence determines `OLLAMA_SELECTED_MODEL` during preflight:

1. **`MODEL_OVERRIDE`** (from `--model` flag or NL extraction in Step 1) —
   highest priority. Validate against `OLLAMA_AVAILABLE_MODELS`. If not
   found, warn but proceed.
2. **Config `backends.ollama.model`** — set via TUI model picker or
   `phone-a-friend config set`. Validate against available models, warn if
   not found.
3. **First model from `/api/tags`** — fallback auto-selection.

- **Do NOT maintain a model priority list** for Ollama. Unlike Gemini, Ollama
  models are locally installed and user-specific. The preflight query
  discovers what's actually available.
- **If "model not found" error occurs mid-loop**: report the error in
  synthesis and suggest the user run `ollama pull <model>` or check available
  models with `ollama list`.

## Notes

- This is a prompt-only feature. All behavioral rules are best-effort prompt
  policy. There is no runtime enforcement of the loop contract or round limits.
- Token usage is higher than a single `/phone-a-friend` call. Each round
  involves at least one relay call plus review overhead.
- For simple one-shot reviews, use `/phone-a-friend` instead. Use
  `/phone-a-team` when you want iterative refinement and convergence checking.

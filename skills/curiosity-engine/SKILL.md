---
name: curiosity-engine
description: Structured Q&A rally between the host orchestrating model and a backend model. Both sides must always reply with ANSWER: and QUESTION:. Seeded by topic, runs for N rounds.
argument-hint: --topic "<topic>" [--rounds N] [--backend codex|gemini|ollama]
---

# /curiosity-engine

A structured ping-pong Q&A game between the host orchestrating model (the
agent running this skill — Claude in Claude Code, the OpenCode model in
OpenCode) and a backend model.
Both sides MUST produce an ANSWER: and a QUESTION: every round.
The game is seeded with a topic and runs for N rounds (default 3, max 6).

## Execution rules

- The host model running this skill is the orchestrator. It serves the
  opening question and answers each round directly. Do NOT call
  `phone-a-friend --to claude` (or any other backend) to generate the
  orchestrator's questions or answers — that would relay the orchestrator
  role to a different model.
- One backend per relay call. Never pass comma-separated values to `--to`
  (e.g. `phone-a-friend --to codex,gemini`).
- `curiosity-engine` is a host slash command / Agent Skill, not a PaF CLI
  subcommand. Never run `phone-a-friend curiosity-engine`.
- `--backend` is an argument to this skill, not a PaF CLI flag. Do not pass
  `--backend` to `phone-a-friend`.
- Inside OpenCode, prefix relay invocations with
  `PHONE_A_FRIEND_HOST=opencode` so PaF detects the host deterministically.
- Suppress the working-tree diff on every binary-mode relay (see "Diff
  suppression" below). Curiosity rounds are seeded with self-contained
  prompts; the diff would be noise.
- Do NOT dump repo files or git output (`git show`, `git diff`,
  `git status`, etc.) into the relay prompt. Curiosity rounds are seeded
  with self-contained prompts; if the round needs file context,
  repo-aware backends (codex, gemini) can read the repo via
  `--repo "$PWD"`. For `ollama` (no repo file access), pick a repo-aware
  backend instead, or ask before sending a minimal excerpt. Inlining
  repo content can leak uncommitted edits or committed secrets and is
  not needed for a Q&A rally. The opening question and round
  transcripts are narrative context that the orchestrator generates and
  inlines into the relay prompt; that is the intended use, not file
  dumping.

## Inputs

- Arguments: `$ARGUMENTS`

## Step 0 — Relay mode

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
| **Codex** | `codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<combined-prompt>" < /dev/null` |
| **Gemini** | `gemini --sandbox --yolo --include-directories "$PWD" --output-format text -m <model> --prompt "<combined-prompt>"` |
| **Ollama** | `curl -s http://localhost:11434/api/chat -H "Content-Type: application/json" -d '{"model":"<model>","messages":[{"role":"user","content":"<combined-prompt>"}],"stream":false}' \| jq -r '.message.content'` |

In direct mode, combine the relay prompt into a single string using this
template:

```
You are helping another coding agent by reviewing or advising on work in a local repository.
Repository path: <repo-path>
Use the repository files for context when needed.
Respond with concise, actionable feedback.

Request:
<relay-prompt>
```

No "Additional Context" section is needed for curiosity-engine (prompts are
self-contained).

Note: do NOT pass PaF flags like `--no-include-diff`, `--fast`, or
`--session` in direct mode. They are CLI flags on the `phone-a-friend`
binary; the underlying backend CLIs do not accept them.

## Diff suppression

`/curiosity-engine` rounds use self-contained prompts; the working-tree diff
would be irrelevant noise. PaF reads `defaults.include_diff` from user
config, so without explicit suppression a user with `include_diff = true`
would silently leak the diff into every relay round.

The cleanest flag is `--no-include-diff`, added in phone-a-friend v2.2.0.
Older binaries reject the flag with `unknown option '--no-include-diff'`.
Probe once before Round 1, then reuse the gate across every binary-mode
relay (initial round, follow-up rounds, and the schema re-prompt):

```bash
if phone-a-friend relay --help 2>/dev/null | grep -q -- '--no-include-diff'; then
  PAF_NO_DIFF="--no-include-diff"
else
  export PHONE_A_FRIEND_INCLUDE_DIFF=false
  PAF_NO_DIFF=""
fi
```

Append `$PAF_NO_DIFF` to every binary-mode `phone-a-friend` invocation in
the steps below. The env var fallback works in v1.7.2 and later; the
explicit flag is preferred when available.

## Step 1 — Parse Arguments

Extract `--topic`, `--rounds`, and `--backend` from `$ARGUMENTS`.

- `--topic <string>` — required. Everything after `--topic` up to the next flag. If missing, ask the user: "What topic should the Curiosity Engine explore?" Do not proceed until provided.
- `--rounds N` — optional, default 3, clamp to [1, 6].
- `--backend codex|gemini|ollama` — optional, default `codex`.

If `--backend` value is not `codex`, `gemini`, or `ollama`: report error and stop.

Set:
- TOPIC = parsed topic string
- MAX_ROUNDS = parsed rounds (default 3, clamped [1, 6])
- BACKEND = parsed backend (default `codex`)
- ROUND = 1

## Step 2 — Preflight Check

### CLI backends

```bash
command -v codex   # if BACKEND=codex
command -v gemini  # if BACKEND=gemini
```

### Ollama backend

```bash
curl -sf http://localhost:11434/api/tags
```

If reachable and `RELAY_MODE = direct`: parse the JSON response to extract
model names from `models[].name`. Set `OLLAMA_SELECTED_MODEL` to the first
model in the list. If the list is empty, abort: "Ollama server is running but
has no models pulled. Install one with: `ollama pull <model-name>`". Report
the selected model to the user: "Ollama: using model `<name>`".

If `RELAY_MODE = binary`, the binary handles model selection internally.

| BACKEND  | Available | Action |
|----------|-----------|--------|
| codex    | yes       | proceed |
| codex    | no        | abort: "codex CLI not found. Install: `npm install -g @openai/codex`" |
| gemini   | yes       | proceed |
| gemini   | no        | abort: "gemini CLI not found. Install: `npm install -g @google/gemini-cli`" |
| ollama   | reachable | proceed (discover model if direct mode) |
| ollama   | not reachable | abort: "Ollama not reachable at localhost:11434. Is Ollama running?" |

## Step 3 — Serve Round 1

The orchestrating agent (the host model running this skill) serves first.
It produces the opening move directly, without relaying to any backend:

```
ANSWER: N/A — I'm serving first.
QUESTION: <orchestrator's opening question on TOPIC — make it genuinely curious and specific>
```

Display to user:
```
--- Round 1 of <MAX_ROUNDS> | Topic: <TOPIC> ---
🤖 <orchestrator>  QUESTION: <question>
```

`<orchestrator>` is the host model's display label (e.g., "Claude" in
Claude Code, the OpenCode model name in OpenCode). Pick one that the user
will recognize.

Then relay to backend:

**Binary mode** (`RELAY_MODE = binary`):
```bash
phone-a-friend --to <BACKEND> --repo "$PWD" --sandbox read-only --fast $PAF_NO_DIFF [--model <model>] --prompt "<relay-prompt>"
```

**Direct mode** (`RELAY_MODE = direct`):
```bash
# Codex:
codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<relay-prompt>" < /dev/null
# Gemini (always include -m):
gemini --sandbox --yolo --include-directories "$PWD" --output-format text -m <model> --prompt "<relay-prompt>"
# Ollama (use OLLAMA_SELECTED_MODEL from Step 2):
curl -s http://localhost:11434/api/chat -H "Content-Type: application/json" \
  -d '{"model":"<OLLAMA_SELECTED_MODEL>","messages":[{"role":"user","content":"<relay-prompt>"}],"stream":false}' \
  | jq -r '.message.content'
```

Where `<relay-prompt>` is:

```
You are playing The Curiosity Engine — a structured Q&A rally with another agent.
Topic: <TOPIC>
Round: 1 of <MAX_ROUNDS>

The orchestrating agent's question for you:
<QUESTION>

You MUST respond in EXACTLY this format — no exceptions, no extra text:

ANSWER: <your answer to the orchestrator's question, 2-4 sentences>
QUESTION: <a new question for the orchestrator on the same topic, that you are genuinely curious about>

Do not add any text before ANSWER: or after the QUESTION line.
```

## Step 4 — Parse Backend Response

If the relay call (binary or direct) produces no output, empty stdout, or a
non-zero exit code:
Display: `⚠️  Relay call failed for round <ROUND>. Ending game early.`
Jump to Step 6 (Synthesis).

After each relay call, parse the response for `ANSWER:` and `QUESTION:` fields.

### Parse algorithm

1. Look for a line starting with `ANSWER:` — extract everything after it (may be multiline until `QUESTION:` appears).
2. Look for a line starting with `QUESTION:` — extract everything after it to end of response.
3. If both fields found → valid response. Proceed to Step 5.
4. If `QUESTION:` is missing → schema violation. Execute re-prompt (see Step 4a).
5. If `ANSWER:` is missing → schema violation. Treat the same as missing `QUESTION:` — execute re-prompt (Step 4a).

### Step 4a — Re-prompt on schema violation

Send one correction relay if `ANSWER:` or `QUESTION:` is missing:

**Binary mode** (`RELAY_MODE = binary`):
```bash
phone-a-friend --to <BACKEND> --repo "$PWD" --sandbox read-only --fast $PAF_NO_DIFF [--model <model>] --prompt "<re-prompt>"
```

**Direct mode** (`RELAY_MODE = direct`):
```bash
# Codex:
codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<re-prompt>" < /dev/null
# Gemini:
gemini --sandbox --yolo --include-directories "$PWD" --output-format text -m <model> --prompt "<re-prompt>"
# Ollama:
curl -s http://localhost:11434/api/chat -H "Content-Type: application/json" \
  -d '{"model":"<OLLAMA_SELECTED_MODEL>","messages":[{"role":"user","content":"<re-prompt>"}],"stream":false}' \
  | jq -r '.message.content'
```

Where `<re-prompt>` is:

```
Your previous response did not follow the required format.
You MUST respond with EXACTLY this structure:

ANSWER: <your answer>
QUESTION: <your question for the orchestrator>

No other text. Try again.
```

Parse again. If still missing `QUESTION:` → end game early. Display:
```
⚠️  <BACKEND> broke the chain on round <N> (missing QUESTION: after re-prompt).
Ending game early. Running synthesis on completed rounds.
```
Jump to Step 6 (Synthesis).

## Step 5 — Display Round and Continue

Display backend's response:
```
🔵 <BACKEND>  ANSWER: <answer>
              QUESTION: <question>
```

If this was the final round (ROUND == MAX_ROUNDS) → jump to Step 6 (Synthesis).

Otherwise, increment ROUND. The orchestrating agent (the host model)
now responds directly — no relay:

```
🤖 <orchestrator>  ANSWER: <orchestrator's genuine answer to backend's question, 2-4 sentences>
                   QUESTION: <orchestrator's new question for backend on TOPIC>
```

Relay the orchestrator's question to backend using this template (same
structure as Step 3, substituting current values):

```
You are playing The Curiosity Engine — a structured Q&A rally with another agent.
Topic: <TOPIC>
Round: <ROUND> of <MAX_ROUNDS>

The orchestrating agent's question for you:
<QUESTION>

You MUST respond in EXACTLY this format — no exceptions, no extra text:

ANSWER: <your answer to the orchestrator's question, 2-4 sentences>
QUESTION: <a new question for the orchestrator on the same topic, that you are genuinely curious about>

Do not add any text before ANSWER: or after the QUESTION line.
```

Repeat Step 4 and Step 5 until MAX_ROUNDS reached or early termination.

**Orchestrator discipline:** the host model ALWAYS provides both ANSWER:
and QUESTION: — never skips either field, never breaks the schema itself.

## Step 6 — Final Synthesis

If ROUND == 1 and no backend response was ever successfully parsed (zero completed rounds):
Display: `No rounds completed — cannot synthesize. Check backend availability and try again.`
Stop.

Present the full session summary:

```
## Curiosity Engine — Session Complete

**Topic:** <TOPIC>
**Backend:** <BACKEND>
**Rounds completed:** <N> of <MAX_ROUNDS>
**Status:** <Converged naturally | Early termination — <BACKEND> broke chain on round N>

---

### Full Rally Transcript

<all rounds, formatted as displayed during play>

---

### Most Interesting Exchange

<orchestrator picks the sharpest Q&A pair from the transcript and explains in 2-3 sentences why it was the most interesting — what tension, insight, or surprise it revealed>

---

### Open Threads

<2-3 questions raised during the rally that weren't followed up on, worth exploring in a future session>
```

## Gemini Model Priority

When BACKEND=gemini, always pass `--model` using the first available model from this list:

1. `gemini-2.5-flash` — reliable, confirmed working
2. `gemini-2.5-pro` — higher capability, frequently at capacity (429)
3. `gemini-2.5-flash-lite` — last resort

When BACKEND=gemini, the relay command must include `--model`:

**Binary mode:**
```bash
phone-a-friend --to gemini --model gemini-2.5-flash --repo "$PWD" --sandbox read-only --fast $PAF_NO_DIFF --prompt "<relay-prompt>"
```

**Direct mode:**
```bash
gemini --sandbox --yolo --include-directories "$PWD" --output-format text -m gemini-2.5-flash --prompt "<relay-prompt>"
```

On capacity/transient errors (429, 500, 503), try the next model before treating as round failure.
Do NOT use aliases like `auto`, `pro`, or `flash` — always use the full model name.

## Constraints

- MAX_ROUNDS clamped to [1, 6]. Never exceed.
- Both sides must always produce ANSWER: and QUESTION:. The orchestrator never breaks the schema.
- One re-prompt allowed per round on schema violation. Two strikes = early termination.
- No nested curiosity-engine sessions.
- phone-a-friend is used as a black box — do not modify its internals.

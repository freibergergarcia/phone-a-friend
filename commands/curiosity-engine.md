---
name: curiosity-engine
description: Structured Q&A rally between Claude and a backend model. Both sides must always reply with ANSWER: and QUESTION:. Seeded by topic, runs for N rounds.
argument-hint: --topic "<topic>" [--rounds N] [--backend codex|gemini|ollama]
---

# /curiosity-engine

A structured ping-pong Q&A game between Claude and a backend model.
Both sides MUST produce an ANSWER: and a QUESTION: every round.
The game is seeded with a topic and runs for N rounds (default 3, max 6).

## Inputs

- Arguments: `$ARGUMENTS`

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
curl -sf http://localhost:11434/api/tags > /dev/null 2>&1
```

| BACKEND  | Available | Action |
|----------|-----------|--------|
| codex    | yes       | proceed |
| codex    | no        | abort: "codex CLI not found. Install: `npm install -g @openai/codex`" |
| gemini   | yes       | proceed |
| gemini   | no        | abort: "gemini CLI not found. Install: `npm install -g @google/gemini-cli`" |
| ollama   | reachable | proceed |
| ollama   | not reachable | abort: "Ollama not reachable at localhost:11434. Is Ollama running?" |

## Step 3 — Serve Round 1

Claude serves first. Claude's opening move:

```
ANSWER: N/A — I'm serving first.
QUESTION: <Claude's opening question on TOPIC — make it genuinely curious and specific>
```

Display to user:
```
--- Round 1 of <MAX_ROUNDS> | Topic: <TOPIC> ---
🤖 Claude  QUESTION: <question>
```

Then relay to backend:

```bash
phone-a-friend --to <BACKEND> --repo "$PWD" --sandbox read-only --prompt "<relay-prompt>"
```

Where `<relay-prompt>` is:

```
You are playing The Curiosity Engine — a structured Q&A rally with Claude.
Topic: <TOPIC>
Round: 1 of <MAX_ROUNDS>

Claude's question for you:
<QUESTION>

You MUST respond in EXACTLY this format — no exceptions, no extra text:

ANSWER: <your answer to Claude's question, 2-4 sentences>
QUESTION: <a new question for Claude on the same topic, that you are genuinely curious about>

Do not add any text before ANSWER: or after the QUESTION line.
```

## Step 4 — Parse Backend Response

If the `phone-a-friend` call produces no output, empty stdout, or a non-zero exit code:
Display: `⚠️  phone-a-friend call failed for round <ROUND>. Ending game early.`
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

```bash
phone-a-friend --to <BACKEND> --repo "$PWD" --sandbox read-only --prompt "<re-prompt>"
```

Where `<re-prompt>` is:

```
Your previous response did not follow the required format.
You MUST respond with EXACTLY this structure:

ANSWER: <your answer>
QUESTION: <your question for Claude>

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

Otherwise, increment ROUND. Claude now responds:

```
🤖 Claude  ANSWER: <Claude's genuine answer to backend's question, 2-4 sentences>
           QUESTION: <Claude's new question for backend on TOPIC>
```

Relay Claude's question to backend using this template (same structure as Step 3, substituting current values):

```
You are playing The Curiosity Engine — a structured Q&A rally with Claude.
Topic: <TOPIC>
Round: <ROUND> of <MAX_ROUNDS>

Claude's question for you:
<QUESTION>

You MUST respond in EXACTLY this format — no exceptions, no extra text:

ANSWER: <your answer to Claude's question, 2-4 sentences>
QUESTION: <a new question for Claude on the same topic, that you are genuinely curious about>

Do not add any text before ANSWER: or after the QUESTION line.
```

Repeat Step 4 and Step 5 until MAX_ROUNDS reached or early termination.

**Claude's discipline:** Claude ALWAYS provides both ANSWER: and QUESTION: — never skips either field, never breaks the schema itself.

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

<Claude picks the sharpest Q&A pair from the transcript and explains in 2-3 sentences why it was the most interesting — what tension, insight, or surprise it revealed>

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

```bash
phone-a-friend --to gemini --model gemini-2.5-flash --repo "$PWD" --sandbox read-only --prompt "<relay-prompt>"
```

On capacity/transient errors (429, 500, 503), try the next model before treating as round failure.
Do NOT use aliases like `auto`, `pro`, or `flash` — always use the full model name.

## Constraints

- MAX_ROUNDS clamped to [1, 6]. Never exceed.
- Both sides must always produce ANSWER: and QUESTION:. Claude never breaks the schema.
- One re-prompt allowed per round on schema violation. Two strikes = early termination.
- No nested curiosity-engine sessions.
- phone-a-friend is used as a black box — do not modify its internals.

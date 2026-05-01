---
name: phone-a-friend
description: Ask Codex, Gemini, Claude, or Ollama for a second opinion through the phone-a-friend CLI while preserving the user's request in --prompt.
argument-hint: [optional review focus]
---

# /phone-a-friend

Use this skill after an assistant reply you want reviewed by another AI.

## Goal

Send compact task context + the latest assistant reply to a backend (Codex, Gemini, or Ollama) using `phone-a-friend`, then bring the feedback back into the current conversation.

## Execution rules

- Preserve the user's actual request in `--prompt`. Do not drop it.
- Do not run a bare `phone-a-friend --to <backend> --review` unless the user
  explicitly asks to review the current diff, branch changes, or staged changes.
- If the user asks for a repo sanity check, architecture opinion, plan critique,
  or general second opinion, use normal prompt mode with `--repo "$PWD"`.
- If the user says not to edit files, keep that instruction in `--prompt`.
- From OpenCode, do not select `opencode` as the friend backend. Choose `codex`,
  `gemini`, `claude`, or `ollama`.
- Suppress the working-tree diff by default (see "Diff suppression" below);
  only include the diff when the user explicitly asked for a
  diff/branch/staged review.
- One backend per call. Never pass comma-separated values to `--to` (e.g.
  `phone-a-friend --to codex,gemini`). To consult multiple models, run
  separate `phone-a-friend` calls. In Claude Code, the `/phone-a-team`
  slash command orchestrates that for you. In OpenCode, run multiple
  separate `phone-a-friend` invocations yourself; `/phone-a-team` is not
  available in OpenCode (it depends on Claude Agent Teams primitives that
  OpenCode does not have).
- `curiosity-engine` is a host slash command / Agent Skill, not a PaF CLI
  subcommand. Never run `phone-a-friend curiosity-engine`. Same shape rule
  applies to any other slash command: never invoke them as PaF
  subcommands (e.g. `phone-a-friend phone-a-team`).
- `--backend` is a `/phone-a-team` skill argument (Claude only), not a PaF
  CLI flag. Do not pass `--backend` to `phone-a-friend`.
- When running inside OpenCode, always prefix relay invocations with
  `PHONE_A_FRIEND_HOST=opencode` (recursion guard) AND
  `PHONE_A_FRIEND_INCLUDE_DIFF=false` (diff suppression that works on
  every shipped binary version). Do NOT use the `$PAF_NO_DIFF`
  probe-and-gate pattern from OpenCode — small host models skip the
  probe and inline `--no-include-diff` literally, which fails on stale
  CLIs. The probe-and-gate is reserved for the rich orchestrator path
  (Claude Code / capable orchestrators).
- Do NOT dump repo files or git output into `--context-file` or
  `--context-text`. Repo-aware backends read files via `--repo "$PWD"`
  using their own tools. See "Context hygiene" below.

For example, from OpenCode:

```bash
PHONE_A_FRIEND_HOST=opencode PHONE_A_FRIEND_INCLUDE_DIFF=false \
  phone-a-friend --to codex --repo "$PWD" \
  --prompt "Give a short sanity review of this repo. Do not edit files." \
  --timeout 300 --no-stream --fast
```

## Inputs

- Review focus (optional): `$ARGUMENTS`

## Host awareness

PaF blocks accidental `OpenCode -> phone-a-friend --to opencode -> OpenCode`
recursion using the `PHONE_A_FRIEND_HOST=opencode` environment marker.
When running from OpenCode, **always** set this marker on every relay
invocation so the recursion guard fires deterministically — the OpenCode
install shims set it automatically, but be explicit when constructing
commands by hand. From Claude Code or other hosts, the marker is not
needed.

When running from OpenCode, do not select `opencode` as the friend backend.
Choose `codex`, `gemini`, `claude`, or `ollama`.

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
| **Codex** | `codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<combined-prompt>" < /dev/null` |
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

Note: do NOT pass PaF flags like `--no-include-diff`, `--fast`, or
`--session` in direct mode. They are CLI flags on the `phone-a-friend`
binary; the underlying backend CLIs do not accept them.

## Context hygiene

Do not generate `--context-file` or `--context-text` from repository files,
`git show`, `git diff`, `git status`, or other local file/git output. Do
not create temp files just to pass repo content. For repo-aware backends
(codex, gemini, claude, opencode), pass `--repo "$PWD"` and let the
backend inspect files with its own tools.

`--context-file` and `--context-text` are reserved for **narrative
context that is not already in the repo** — for example: conversation
history that the backend cannot see, your own analysis, user constraints,
prior model output you want reviewed. These remain valid and useful.

Inlining repo content is wasteful, can leak tracked uncommitted edits or
committed secrets into the relay payload, and bypasses the backend's
normal file-access controls.

Backend exception: `ollama` has `localFileAccess: false` and cannot read
the repo on its own. For Ollama specifically, ask the user before sending
file content, and send a minimal excerpt rather than bulk-dumping files
or git output.

## Diff suppression

PaF reads `defaults.include_diff` from user config. If a user has
`include_diff = true` set, every relay would silently leak the working-tree
diff into the prompt. Suppress the diff explicitly on every binary-mode
relay.

The cleanest flag is `--no-include-diff`, added in phone-a-friend v2.2.0.
Older binaries reject the flag with `unknown option '--no-include-diff'`.
Probe once at the start of the workflow, then reuse the gate:

```bash
if phone-a-friend relay --help 2>/dev/null | grep -q -- '--no-include-diff'; then
  PAF_NO_DIFF="--no-include-diff"
else
  export PHONE_A_FRIEND_INCLUDE_DIFF=false
  PAF_NO_DIFF=""
fi
```

Append `$PAF_NO_DIFF` to every binary-mode `phone-a-friend` invocation. The
env var fallback works in v1.7.2 and later; the explicit flag is preferred
when available.

Only when the user explicitly asked to review the diff, branch changes, or
staged changes, swap `$PAF_NO_DIFF` for `--include-diff` (and prefer
`phone-a-friend ... --review` for branch-level reviews).

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
   phone-a-friend --to codex --repo "$PWD" --prompt "<relay-prompt>" --context-text "<context-payload>" $PAF_NO_DIFF [--fast] [--session <id>]
   # For gemini, always include --model (see "Gemini Model Priority" below).
   # Do NOT pass --session to gemini — it will error (see "Session continuity" below):
   phone-a-friend --to gemini --repo "$PWD" --prompt "<relay-prompt>" --context-text "<context-payload>" --model <model> $PAF_NO_DIFF [--fast]
   ```

   `$PAF_NO_DIFF` comes from the probe in "Diff suppression" above. Swap
   for `--include-diff` only when the user explicitly asked to review the
   diff, branch changes, or staged changes (and prefer
   `phone-a-friend ... --review` for branch-level reviews).

   See "Speed optimization" and "Session continuity" below for when to
   include `--fast` and `--session`.

   **Direct mode** (`RELAY_MODE = direct`):
   ```bash
   # Codex:
   codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<combined-prompt>" < /dev/null
   # Gemini (always include -m, see "Gemini Model Priority" below):
   gemini --sandbox --yolo --include-directories "$PWD" --output-format text -m <model> --prompt "<combined-prompt>"
   ```

   In direct mode, build `<combined-prompt>` using the template from the
   "Direct call reference" section, substituting `<relay-prompt>` and
   `<context-payload>` into the template.

   Note: `--fast`, `--session`, and `--no-include-diff` are PaF CLI flags
   only available in binary mode. Do not append them to direct-mode
   invocations of `codex` or `gemini`.

5. Return backend feedback in concise review format:
   - Critical issues
   - Important issues
   - Suggested fixes

## Speed optimization

When building binary-mode relay commands, add `--fast` if ALL of these are true:

- The relay prompt is self-contained (all needed context is in `--prompt`
  and/or `--context-text`)
- The task does NOT reference project conventions, coding standards, or
  CLAUDE.md rules that the backend needs to read
- The task does NOT need MCP tools (GitHub API, Slack, database queries)

`--fast` maps to `--pure` for OpenCode, skipping external plugins. It is a
no-op for Claude, Codex, Gemini, and Ollama. Claude intentionally does not
use `--bare` because bare mode skips OAuth/keychain reads and can break
subscription auth.

Most `/phone-a-friend` relay calls are self-contained reviews where the
context is already in the prompt. Default to including `--fast` when the
backend may be OpenCode; it is harmless elsewhere.

## Session continuity

If this relay is a follow-up to a previous `/phone-a-friend` relay in the
same conversation (e.g., user asked for a review, saw the feedback, and now
wants the same backend to apply fixes or dig deeper), reuse the session:

1. On the **first** relay in a conversation, generate a session ID:
   `paf-<backend>-<short-slug>-<4-char-random>` (e.g.,
   `paf-codex-auth-review-a3f2`). The random suffix prevents collisions
   across repos and conversations.
2. Add `--session <id>` to the relay command.
3. On **subsequent** relays to the **same backend** in the same
   conversation, reuse the same session ID. The backend remembers previous
   turns.
4. If switching backends (e.g., first call to codex, second to ollama),
   generate a new session ID for the new backend. Sessions are
   backend-specific.

Benefits: the backend keeps full conversation history, so follow-up prompts
can be shorter (no need to re-send context from previous turns).

**Backend-specific behavior:**
- **Codex, Claude, OpenCode**: native session resume. Follow-up prompts
  can send deltas only.
- **Ollama**: replays full history each call. Sessions work but prompt
  size grows with each turn. Keep follow-ups concise.
- **Gemini**: `--session` is **not supported**. PaF rejects it with a
  RelayError (`--session is not supported by the gemini backend ...`).
  Each Gemini relay call must be self-contained. Do not pass `--session`
  with `--to gemini`.

On the FIRST relay under a new session label, PaF prints an informational
stderr line: `[phone-a-friend] Session label "..." not found in store.
Starting a fresh session under this label.` This is expected. The hint
about `--backend-session` in that line is for advanced use (see below)
and not relevant to the typical `/phone-a-friend` flow.

**Omit `--session`** for one-off relays where no follow-up is expected.
This is the common case. Only add `--session` when the user explicitly
asks for a follow-up or continuation of a previous relay.

Session continuity is only available in binary mode (`RELAY_MODE = binary`).

### Advanced: `--backend-session` (raw thread ID adoption)

If the user explicitly provides a Codex/Claude/OpenCode backend thread ID
that PaF did not create (e.g., from another tool or a previous CLI run),
attach to it with `--backend-session <id>` instead of `--session <id>`.
Combine with `--session <label>` to also start tracking under a label.

```bash
# Resume a raw backend thread once (no PaF persistence):
phone-a-friend --to codex --repo "$PWD" --backend-session <thread-id> --prompt "<...>" $PAF_NO_DIFF

# Adopt: resume AND start tracking under a PaF label going forward:
phone-a-friend --to codex --repo "$PWD" --session <label> --backend-session <thread-id> --prompt "<...>" $PAF_NO_DIFF
```

This is rarely the right move from inside a Claude Code conversation — the
common case is `--session <label>` with a fresh label. Only use
`--backend-session` when the user supplied a specific backend thread ID.

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

Lead with `gemini-2.5-flash` — fast, reliable, and confirmed across many relay
sessions. `gemini-2.5-pro` is higher capability but frequently at capacity
(429); use it deliberately, not as a default. Preview tracks (such as
`gemini-3.1-pro-preview-*`) are listed in Google's docs but may not be
deployed yet; PaF will auto-fall-back when one returns 404.

1. `gemini-2.5-flash` — reliable, fast, confirmed working (default)
2. `gemini-2.5-flash-lite` — automatic fallback when flash is unavailable
3. `gemini-2.5-pro` — higher capability, opt-in for harder reviews; 429-prone

### Fallback rule

PaF binary mode (`phone-a-friend --to gemini`) auto-falls-back at the relay
layer. When the requested model returns model-not-found (404), PaF caches it
as unavailable for 24h and retries with `gemini-2.5-flash` and then
`gemini-2.5-flash-lite`, surfacing one stderr line per fallback hop. Capacity
(429 / RESOURCE_EXHAUSTED) errors retry without caching. Authentication and
unknown errors propagate immediately — fallback won't help.

To disable auto-fallback (debugging or exact reproduction):

```bash
PHONE_A_FRIEND_GEMINI_AUTO_FALLBACK=false phone-a-friend --to gemini --model X --prompt "..."
```

When invoking the `gemini` CLI directly (without `phone-a-friend --to gemini`),
auto-fallback does NOT apply — the orchestrator is responsible for retry. In
that case, retry rules:

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

- Prefer `--context-text` for small narrative payloads.
- `--context-file` and `--context-text` are mutually exclusive.
- If your narrative context is too large for inline args, write it to a
  temp file outside the repo (e.g. under `/tmp`). Do NOT use a repo-local
  temp file — it muddies git status and risks accidental commit. Repo
  content itself does not need a temp file at all; see "Context hygiene"
  above.

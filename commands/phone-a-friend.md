---
name: phone-a-friend
description: Ask Codex, Gemini, Claude, or Ollama for a second opinion through the phone-a-friend CLI while preserving the user's request in --prompt.
argument-hint: [optional review focus]
---

# /phone-a-friend

Use this command after an assistant reply you want reviewed by another AI.

## Goal

Send compact task context + the latest assistant reply to a backend (Codex,
Gemini, Claude, or Ollama) using `phone-a-friend`, then bring the feedback back
into the current conversation.

## Execution rules

- Preserve the user's actual request in `--prompt`. Do not drop it.
- Do not run a bare `phone-a-friend --to <backend> --review` unless the user
  explicitly asks to review the current diff, branch changes, or staged changes.
- If the user asks for a repo sanity check, architecture opinion, plan critique,
  or general second opinion, use normal prompt mode with `--repo "$PWD"`.
- If the user says not to edit files, keep that instruction in `--prompt`.
- Suppress the working-tree diff by default (see "Diff suppression" below);
  only include the diff when the user explicitly asked to review the diff,
  branch changes, or staged changes.
- One backend per call. Never pass comma-separated values to `--to` (e.g.
  `phone-a-friend --to codex,gemini`). To consult multiple models, run
  separate `phone-a-friend` calls. The `/phone-a-team` slash command
  orchestrates that for you in Claude Code.
- `curiosity-engine` is a host slash command / Agent Skill, not a PaF CLI
  subcommand. Never run `phone-a-friend curiosity-engine`. Same shape rule
  applies to any other slash command: never invoke them as PaF
  subcommands (e.g. `phone-a-friend phone-a-team`).
- `--backend` is a `/phone-a-team` skill argument, not a PaF CLI flag. Do
  not pass `--backend` to `phone-a-friend`.
- Do NOT dump repo files or git output into `--context-file` or
  `--context-text`. Repo-aware backends read files via `--repo "$PWD"`
  using their own tools. See "Context hygiene" below.

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

In direct mode, also verify the backend CLI is available (`command -v codex`
or `command -v gemini`) before calling it. If not found, tell the user how
to install it and stop.

Note: do NOT pass PaF flags like `--no-include-diff`, `--fast`, or
`--session` in direct mode. Those are CLI flags on the `phone-a-friend`
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
diff into the prompt. To prevent that, every binary-mode relay must suppress
the diff explicitly.

The cleanest flag is `--no-include-diff`, which was added in
phone-a-friend v2.2.0 (the same release that introduced this command).
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

Then append `$PAF_NO_DIFF` to every binary-mode `phone-a-friend` invocation.
The env var fallback works in v1.7.2 and later; the explicit flag is
preferred when available because it doesn't leak the override into child
processes.

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
   # For gemini, omit --model by default (let auto-routing pick); see "Gemini model selection" below.
   # Do NOT pass --session to gemini — it will error (see "Session continuity" below):
   phone-a-friend --to gemini --repo "$PWD" --prompt "<relay-prompt>" --context-text "<context-payload>" $PAF_NO_DIFF [--fast]
   ```

   `$PAF_NO_DIFF` comes from the probe in "Diff suppression" above. It
   resolves to `--no-include-diff` on new binaries and an empty string on
   stale binaries (with `PHONE_A_FRIEND_INCLUDE_DIFF=false` exported as
   the fallback).

   See "Speed optimization" and "Session continuity" below for when to
   include `--fast` and `--session`.

   **Direct mode** (`RELAY_MODE = direct`):
   ```bash
   # Codex:
   codex exec -C "$PWD" --skip-git-repo-check --sandbox read-only "<combined-prompt>" < /dev/null
   # Gemini (omit -m for auto-routing; pin only when reproducibility/capability is needed):
   gemini --sandbox --yolo --include-directories "$PWD" --output-format text --prompt "<combined-prompt>"
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
context is already in the prompt. Default to including `--fast`; it is
harmless for Claude/Codex/Gemini/Ollama and meaningful for OpenCode.

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

## Gemini model selection

By default, **omit `--model`** for `--to gemini` and let Gemini CLI's
auto-routing pick. This mirrors how `--to codex` and `--to claude` are used
in this command — the CLI's own default is the right default. Pinning
`--model` ages docs poorly; auto-routing tracks deployed models for you.

Set `--model` explicitly only when you need:

- **Reproducibility** — pinning produces deterministic behavior across runs.
- **Capability** — a more capable model for a specific task (e.g.,
  `--model gemini-2.5-pro` for a hard review, accepting more 429s).
- **Debugging** — isolating model behavior from auto-routing changes.

### Cache-aware failure for explicit pins

When you pin a model and it returns a strong 404 (`ModelNotFoundError`),
PaF caches it as unavailable for 24h at
`~/.config/phone-a-friend/gemini-models.json` and surfaces a clear error
that includes the cache path, expiry timestamp, and bypass instructions.
PaF does **not** auto-substitute another model — explicit pins surface
explicit failures so the caller decides whether to retry, switch model,
or omit `--model` and rely on auto-routing.

What is and isn't cached:

- **Cached** (24h): strong 404 (`ModelNotFoundError` from gemini-cli's own classifier).
- **Not cached**: ambiguous 404s (could be a missing project / file, not the model), 429 / RESOURCE_EXHAUSTED, authentication failures, any other error class.
- **Not consulted**: when `--model` is unset (auto-routing), or during session resume (`--resume`).

To bypass the cache (debugging stale entries, testing recovery):

```bash
PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false phone-a-friend --to gemini --model X --prompt "..."
```

Or delete `~/.config/phone-a-friend/gemini-models.json` to clear it.

### Direct Gemini CLI mode

When the orchestrator is calling `gemini` directly (no PaF wrapper), the
dead-model cache does NOT apply — the orchestrator is responsible for any
retry. Retry rules in direct mode:

- **Retry**: HTTP 429, 499, 500, 503, 504; RESOURCE_EXHAUSTED; transient/timeout errors.
- **Do NOT retry**: authentication failures, invalid arguments, permission errors, model-not-found.
- **Default**: if an error cannot be confidently classified as transient, surface it immediately.

This does NOT apply to `--to codex` or `--to claude`.

## Notes

- Prefer `--context-text` for small narrative payloads.
- `--context-file` and `--context-text` are mutually exclusive.
- If your narrative context is too large for inline args, write it to a
  temp file outside the repo (e.g. under `/tmp`). Do NOT use a repo-local
  temp file — it muddies git status and risks accidental commit. Repo
  content itself does not need a temp file at all; see "Context hygiene"
  above.

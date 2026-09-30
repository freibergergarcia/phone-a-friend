<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/logo-light.svg">
    <img alt="phone-a-friend" src="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/logo-dark.svg" width="480">
  </picture>

  <p><em>When your AI needs a second opinion.</em></p>

  [![npm](https://img.shields.io/npm/v/%40freibergergarcia%2Fphone-a-friend)](https://www.npmjs.com/package/@freibergergarcia/phone-a-friend)
  [![CI](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml/badge.svg)](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml)
  [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
  ![Node.js 22.13+](https://img.shields.io/badge/node-%E2%89%A522.13-green)

</div>

`phone-a-friend` is a CLI orchestration layer for AI coding agents.
Relay tasks to any backend, spin up multi-model teams, or run persistent multi-agent sessions.

| Mode | What it does | Best for |
|------|-------------|----------|
| **Relay** | One-shot delegation to Antigravity, Codex, Gemini, Ollama, Claude, OpenCode, or pi | Quick second opinions, code reviews, analysis |
| **Team** | Iterative multi-backend refinement over N rounds | Collaborative review, converging on a solution |
| **Agentic** | Persistent multi-agent sessions with @mention routing | Autonomous collaboration, adversarial review, deep analysis |

### Host parity

| Feature | Claude Code | OpenCode | Codex | pi |
|---|:---:|:---:|:---:|:---:|
| `/phone-a-friend` (single + parallel multi-backend relay) | ✓ | ✓ | ✓ | `/skill:phone-a-friend` |
| `/curiosity-engine` (Q&A rally) | ✓ | ✓ | ✓ | `/skill:curiosity-engine` |
| `/phone-a-team` (iterative multi-model team) | ✓ | — | ✓ | — |
| Plugin marketplace install | ✓ | — | ✓ | `pi install` |
| CLI plugin install (`phone-a-friend plugin install --<host>`) | ✓ | ✓ | ✓ | ✓ |
| Skill auto-discovery | ✓ | ✓ | ✓ | ✓ |
| Recursion guard (`PHONE_A_FRIEND_HOST=<host>`) | n/a | ✓ | ✓ | automatic |

Claude `/phone-a-team` orchestrates rounds with Agent Teams: the lead spawns named teammates through the Agent tool and coordinates them with SendMessage. It needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your settings `env` (teams are off by default) and shows one split pane per teammate when `teammateMode` is `"tmux"`; otherwise it falls back to direct relays in the lead session. On Claude, `/phone-a-friend` reviews run in the background through the plugin's `paf-reviewer` subagent, so they show up in the agent panel and come back as a receipt plus verbatim findings. Codex `/phone-a-team` is pure Bash orchestration directly from the skill body, with Codex's own model handling the synthesis between rounds. OpenCode has no comparable primitive and replicates `/phone-a-team` by running repeated `/phone-a-friend` calls manually.

> [!IMPORTANT]
> **Codex users:** A host sandbox can restrict backend network or keychain access,
> but an authentication error or timeout alone does not identify the cause. Start
> with `phone-a-friend doctor --json`, then compare the same backend executable
> and auth profile in a regular terminal. Keep PaF's read-only default. For a
> confirmed host restriction, use authorized command escalation or an authorized
> terminal run. `--full-auto` is not an unrestricted sandbox mode. Switching to
> API-key billing is a separate choice.

## Quick Start

**Prerequisites:** Node.js 22.13+ and at least one backend:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup)
- [Google Antigravity CLI](https://antigravity.google/) (`agy`) for Google AI Pro/Ultra or consumer Google accounts
- [Codex CLI](https://developers.openai.com/codex/quickstart/)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) for API key, Vertex AI, or enterprise Gemini Code Assist flows
- [Ollama](https://ollama.com/download)
- [OpenCode](https://opencode.ai/docs)
- [pi](https://github.com/earendil-works/pi) 0.79.0 or newer (`npm install -g @earendil-works/pi-coding-agent`), for tool-using relays to local models

**Install:**

```bash
npm install -g @freibergergarcia/phone-a-friend
phone-a-friend    # first run shows a guided menu — choose Setup
```

The setup wizard detects your backends, offers to install detected host integrations, and verifies everything works.

**Claude Code marketplace (commands and skills only):**

```
/plugin marketplace add freibergergarcia/phone-a-friend
/plugin install phone-a-friend@phone-a-friend-marketplace
```

To update: `/plugin marketplace update phone-a-friend-marketplace` then `/plugin update phone-a-friend@phone-a-friend-marketplace`.

> [!NOTE]
> Marketplace install ships only the slash commands and skills. For the full CLI (agentic mode and TUI), install via `npm install -g @freibergergarcia/phone-a-friend`.

**OpenCode commands and skills:**

If you use [OpenCode](https://opencode.ai/docs), install the same Phone-a-Friend skills plus thin slash-command shims into your OpenCode config:

```bash
phone-a-friend plugin install --opencode
```

This installs to `~/.config/opencode/skills/` and `~/.config/opencode/commands/` (or `$XDG_CONFIG_HOME/opencode/...`). From OpenCode, ask naturally, for example:

```
Ask Codex through phone-a-friend for a short sanity review of this repo; do not edit files.
```

**Codex plugin (skills + marketplace registration):**

If you use [Codex CLI](https://developers.openai.com/codex/quickstart/), install the Phone-a-Friend plugin two ways:

Via the Codex marketplace (visible in `/plugins` like Claude):

```
codex plugin marketplace add freibergergarcia/phone-a-friend
codex plugin add phone-a-friend@phone-a-friend-marketplace
```

Or via the PaF CLI (does both the marketplace registration AND drops skills into `~/.codex/`):

```bash
phone-a-friend plugin install --codex
```

This installs `phone-a-friend`, `curiosity-engine`, and `phone-a-team` skills into `$CODEX_HOME/skills/` (defaulting to `~/.codex/skills/`). All three are orchestrated through pure Bash from the skill bodies — no Codex subagent primitive is required.

> [!NOTE]
> Unlike Claude's marketplace, Codex marketplace install ships the skills directly — `codex plugin marketplace add` + `codex plugin add` is sufficient to use `/phone-a-friend`, `/curiosity-engine`, and `/phone-a-team` from inside Codex. For the full CLI (TUI and agentic mode), install via `npm install -g @freibergergarcia/phone-a-friend`. Running `phone-a-friend plugin install --codex` after the npm install additionally drops loose-file skills under `~/.codex/skills/` as a no-marketplace fallback.

From Codex, ask naturally:

```
Ask Claude and Gemini through phone-a-friend what they think of this code.

Use phone-a-team across Claude and Gemini to converge on a fix for this auth bug. Three rounds max.
```

**pi skills:**

If you use [pi](https://pi.dev), install the `phone-a-friend` and `curiosity-engine` skills into pi's agent directory:

```bash
phone-a-friend plugin install --pi
```

This installs to `~/.pi/agent/skills/` (or `$PI_CODING_AGENT_DIR/skills/`). pi has no command shims: it exposes every skill as `/skill:<name>`, so from pi run:

```
/skill:phone-a-friend ask claude for a short sanity review of this repo; do not edit files
/skill:curiosity-engine --topic "why the sky is blue" --rounds 2 --backend antigravity
```

The same form works for a one-shot run: `pi -p "/skill:phone-a-friend ask claude ..."`. pi needs its `bash` tool (on by default) to run the relay.

- **Use the `/skill:` form with local models.** pi lists the skill to the model, but a local model may not load it on its own. In testing, a 35B model given a plain "ask Claude through phone-a-friend" request guessed the CLI flags instead and relayed to the wrong backend; with `/skill:phone-a-friend` the same model ran the correct relay first time.
- **No recursion marker is needed.** pi sets `PI_CODING_AGENT=true` for the commands it runs, and PaF refuses `--to pi` from there.
- **Alternative: pi's own package manager.** The npm package is also a pi package that exposes the same two skills: `pi install npm:@freibergergarcia/phone-a-friend`. Use one path or the other; with both, pi keeps the first skill it finds and warns about the name collision. `doctor` and the TUI recognize the npm form; a package installed from a git URL works in pi but shows as not installed there. You still need the npm global install for the `phone-a-friend` command itself.
- **Uninstall** (`phone-a-friend plugin uninstall --pi`) removes only what PaF installed. A skill of your own under the same name is kept.

**From source:**

```bash
git clone https://github.com/freibergergarcia/phone-a-friend.git
cd phone-a-friend
npm install && npm run build
./dist/index.js   # first run guides you through setup
```

Then from Claude Code or OpenCode, just talk naturally — the host integration loads the skills automatically:

```
Ask Gemini to review the error handling in relay.ts

Spin up Codex and Gemini to review the docs.
Then spin another agent to review their reviews and report back.

Build a team with Claude and Ollama. Have them review the website copy,
loop through 3 rounds, and converge on final suggestions.
```

No slash commands needed once the host integration is installed (see [Host parity](#host-parity) for which slash commands work in which host).

> [!TIP]
> **Claude Code power-user setup:** Run in [**tmux**](https://formulae.brew.sh/formula/tmux) with [**bypass permissions**](https://docs.anthropic.com/en/docs/claude-code/security) (`⏵⏵`) and [**Agent Teams**](https://docs.anthropic.com/en/docs/claude-code/agent-teams) to watch agents work in parallel split panes. Pair with **phone-a-friend agentic mode** for fully autonomous sessions.

## CLI Usage

### Relay

Delegate a task to any backend and get the result back:

```bash
phone-a-friend --to codex --prompt "Review this code"
phone-a-friend --to antigravity --prompt "Review this code" --sandbox read-only
phone-a-friend --prompt "Compare these" --context-file plan.md --context-file review.md  # several context files, in order
phone-a-friend --to gemini --prompt "Analyze the architecture"
phone-a-friend --to claude --prompt "Refactor this module"
phone-a-friend --to ollama --prompt "Explain this function"
phone-a-friend --to opencode --prompt "Audit this repo" --model qwen3-coder  # Local agentic (OpenCode + Ollama)
phone-a-friend --to claude --prompt "Review this code" --stream   # Stream tokens live
phone-a-friend --to codex --prompt "Audit the auth module" --quiet # Run silently, save result
phone-a-friend --to codex --review --no-task-history            # Skip the local task record
phone-a-friend --to opencode --prompt "Explain this" --fast        # Skip OpenCode plugins (faster)
phone-a-friend --to pi --prompt "Review this module" --fast        # Local model through pi (see Backends)
phone-a-friend --to codex --prompt "Review my fix" --include-diff   # Append `git diff HEAD` to the prompt
phone-a-friend --to codex --prompt "Quick question" --no-include-diff  # Override defaults.include_diff = true
phone-a-friend --to claude --prompt "Coordinate with the migration session" --peer-messaging accept
```

### Structured output

Request JSON responses matching a schema:

```bash
phone-a-friend --to codex --prompt "List files that need refactoring" \
  --schema '{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}},"required":["files"],"additionalProperties":false}'
```

Antigravity, Claude, Codex, and Ollama enforce the schema through their native structured-output surfaces. Gemini, OpenCode CLI, and pi use prompt injection (best-effort), with PaF validating built-in verdict envelopes before returning them.

Codex also receives the schema on follow-ups through `--session` or
`--backend-session`. PaF checks `codex exec resume --help` using the invocation's
PATH before a schema-bearing resume. Unsupported or failed checks stop before
model execution with an actionable error; plain resumes do not need this probe.

### Sessions

Resume previous relay conversations for multi-turn workflows:

```bash
phone-a-friend --to codex --prompt "Review the auth module" --session auth-review
# Later, continue the conversation:
phone-a-friend --to codex --prompt "Now fix those issues" --session auth-review
```

Sessions work with Antigravity, Claude, Codex, Gemini, OpenCode, and pi. Ollama replays history (may hit token limits on long conversations).

### Claude peer messaging

On supported macOS and Linux setups, Claude Code 2.1.224+ can list and message
other live Claude Code sessions on the same machine. PaF exposes that
capability deliberately for Claude relays:

```bash
# Use Claude's native inbound policy while allowing peer discovery/messages (default)
phone-a-friend --to claude --prompt "Ask the payments session for its status" \
  --peer-messaging native --session payments-coordinator

# Deliver peer messages to the unattended PaF worker immediately
phone-a-friend --to claude --prompt "Coordinate the migration" \
  --peer-messaging accept --session migration-coordinator

# Isolate this relay from peer messaging in both directions
phone-a-friend --to claude --prompt "Review privately" --peer-messaging refuse
```

`native` is the default: PaF makes `ListAgents` and `SendMessage` available but
leaves inbound delivery to Claude Code's own permission-mode rules. `accept`
sets `crossSessionInbound` to `accept`, which is the autonomy-first choice for
unattended workers. `refuse` rejects inbound messages and removes the peer
tools. Peer-visible workers are named from the PaF session label, such as
`paf-migration-coordinator`; one-shot relays use `paf-relay`.

Set your preferred mode once:

```bash
phone-a-friend config set backends.claude.peer_messaging accept
```

On Claude Code 2.1.236+, the main session can request a one-shot idle notice
with `SendMessage`'s `notify_when_idle`. An idle notice is not a completed-review
verdict; inspect the result. See [peer notifications](https://code.claude.com/docs/en/cross-session-messaging#get-a-notice-when-another-session-goes-idle).

### Job tracking

The `--quiet` flag saves the result to a local job store for later retrieval:

```bash
phone-a-friend --to codex --prompt "Review this" --quiet   # Waits for completion and stores the result
phone-a-friend job status                                    # List all jobs
phone-a-friend job result <id>                               # Show stored output
phone-a-friend job cancel <id>                               # Mark a pending/running job cancelled
```

`--quiet` does not detach the process. `job cancel` updates stored status; it does not terminate the backend subprocess.

### Task tracking

Every relay and review is recorded as a task in `~/.config/phone-a-friend/tasks.db`, so you can find delegated work from another terminal or after your host conversation has moved on:

```bash
phone-a-friend --to codex --review --review-scope working-tree
#   ◇ Task 3f9a2c1d started · phone-a-friend task show 3f9a2c1d   (stderr)
phone-a-friend task list --repo .            # Newest tasks for this repository
phone-a-friend task show 3f9a                # Scope, backend session, drift check, event log (prefix ok)
phone-a-friend task result 3f9a2c1d          # Stored result; exit 3 while still running
phone-a-friend task prune --older-than 30    # Housekeeping (--all drops everything)
```

Reviews hash the collected diff before the backend starts and re-check it afterwards. If the working tree changed during the review, PaF says so on stderr and marks the task, because the result covers the original snapshot only. Codex reviews stream progress events (commands run, messages) into the task log; other backends record lifecycle events only, and a quiet task is not a stuck one.

Retention is a setting: `defaults.task_history = "results"` (default) keeps the result text plus a short prompt preview and hashes, `"metadata"` drops the text, `"off"` records nothing. `PHONE_A_FRIEND_TASK_HISTORY` overrides the config and `--no-task-history` skips one run. Deleting a task never deletes the backend's own session.

From Claude Code, the `/phone-a-friend` skill runs reviews as background shell tasks so you can keep working; the result returns to the conversation when the command exits, and the task record is the fallback when that context is gone.

While a relay runs, PaF reports progress on stderr: one line per backend-reported event when stderr is not a terminal (`◇ 00:12 Running: git diff`), or folded into the spinner text when it is. Every run ends with a receipt such as `◇ Task 3f9a2c1d completed · 23s · scope unchanged`.

#### Status line

`phone-a-friend task status-line` prints one row for the repository your Claude Code session is in: `◇ codex review 00:45 · Running: git diff` while a task runs, then `◇ codex review done 40s ago · tree unchanged` for two minutes, then nothing. It reads Claude Code's status line JSON on stdin, so it drops straight into `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "phone-a-friend task status-line",
    "refreshInterval": 5
  }
}
```

If you already have a status line script, feed both commands the same stdin from a small wrapper:

```bash
#!/usr/bin/env bash
input=$(cat)
printf '%s' "$input" | bash ~/.claude/my-statusline.sh
printf '%s' "$input" | phone-a-friend task status-line
```

It prints nothing when no task is running or finished within the last two minutes (`--recent <minutes>` changes the window), so the row only appears when there is something to say. It deliberately omits the task id; `phone-a-friend task list --repo .` has it.

### Review

Context-aware code reviews collect an explicit Git scope so you don't have to paste code:

```bash
phone-a-friend --to claude --review                           # Committed branch changes (default)
phone-a-friend --to codex --review --review-scope working-tree # Staged, unstaged, and untracked
phone-a-friend --to opencode --review --review-scope all       # Branch plus working-tree changes
phone-a-friend --to codex --review --base develop              # Use a specific comparison branch
```

| `--review-scope` | Included changes |
|---|---|
| `branch` (default) | Committed changes from the merge base with `--base` through `HEAD` |
| `working-tree` | Staged, unstaged, and non-ignored untracked files relative to `HEAD` |
| `all` | Branch changes plus staged, unstaged, and non-ignored untracked files |

Pass a repository root, linked Git worktree, or any directory inside one through
`--repo <path>`; review mode normalizes it to the containing worktree root before
collecting changes. Before the first commit, `working-tree` and `all` compare
pending files against Git's empty tree. PaF collects and bounds the selected
scope before any native or generic backend call, so the normal diff size limit
always applies. When PaF supplies a generic diff, untracked binary files use a
binary-change marker instead of raw bytes.

If the selected scope is clean, PaF does not invoke a backend. Plain review
returns `No changes found for review scope "<scope>".`; `--verdict-json` returns
a valid `abstain` envelope with no findings. Native review is used only when the
backend supports the selected non-empty scope; otherwise PaF supplies the
deterministic diff through the generic path.

`--include-diff` remains available for normal prompt mode. It cannot be combined with review mode; select `working-tree` or `all` instead. To override a `defaults.include_diff = true` config setting on a normal relay, use `--no-include-diff` (or set `PHONE_A_FRIEND_INCLUDE_DIFF=false` in the environment for older binaries).

> [!TIP]
> Don't paste code into `--prompt` just to review it — the backend can read the repo directly via `--repo "$PWD"` (default: current working directory). Pasting risks leaking uncommitted edits and burns tokens for content the backend can fetch itself.

### Agentic

Spawn multiple agents that collaborate via @mentions (see [Agentic Mode](#agentic-mode) below):

```bash
phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "Review this code"
phone-a-friend agentic logs               # View past sessions
phone-a-friend agentic replay --session <id>  # Replay transcript
```

Agentic mode currently supports Claude only. Other native-session backends
(Codex, Gemini, OpenCode) are rejected rather than routed to Claude; their normal
relay mode remains available. Agentic errors produce a nonzero CLI exit code.
Timeouts and turn caps with pending work are saved as failed with their end reason,
and return a nonzero exit code. Partial output from failed agents remains in the
transcript. Stop and timeout cancel in-flight calls; on POSIX, PaF terminates their
process groups and waits for shutdown before closing the event stream.

`--sandbox` sets Claude's tool policy on both initial and resumed calls:
read-only allows read/search tools, workspace-write adds Edit/Write, and
danger-full-access bypasses permissions. This is tool policy, not OS isolation.

Relay labels and history use `~/.config/phone-a-friend/sessions.db`. SQLite
transactions preserve concurrent team writes. The first access imports existing
`sessions.json` once and leaves valid JSON as a recovery copy. Use the same PaF
version for session writes after migration: older binaries still write JSON.

### Ops

```bash
phone-a-friend                 # Interactive TUI dashboard (TTY only)
phone-a-friend setup           # Guided setup wizard
phone-a-friend doctor          # Health check all backends + host install status
phone-a-friend plugin install --claude    # Install Claude Code plugin
phone-a-friend plugin install --opencode  # Install OpenCode commands and skills
phone-a-friend plugin install --codex     # Install Codex skills
phone-a-friend plugin install --pi        # Install pi skills (/skill:phone-a-friend)
phone-a-friend config show     # Show resolved config
phone-a-friend config edit     # Open in $EDITOR
```

`doctor` reports CLI backends, local backends (Ollama), host integration status (Claude / OpenCode / Codex / pi install state), and a summary count. Antigravity, OpenCode CLI, and pi are treated as optional: if you don't have `agy`, OpenCode, or pi installed, doctor will show them but will not flag that as a degraded state.

`doctor --json` also reports each CLI's selected executable, version, and other
PATH candidates. It distinguishes the running PaF build from the PATH install,
configured models from unknown backend-reported models, and adapter-declared
capabilities from runtime verification. Version probes are bounded and never
request model inference. If a relay behaves differently from your host app,
compare these paths and versions before changing authentication or upgrading.

### Update notifications

phone-a-friend checks the npm registry for newer stable releases at most once
every 24 hours and prints a one-time stderr banner the next time it runs in an
interactive terminal. The current invocation is never slowed down: the registry
fetch happens in the background, with results applied on the next run.

Sample banner:

```
  ↑ phone-a-friend X.Y.Z available (current: A.B.C)
    Run: npm install -g @freibergergarcia/phone-a-friend@latest
```

The banner is suppressed automatically when:
- stdout or stderr is not a TTY (piped or redirected output)
- `CI` is set, or `TERM=dumb`
- the command uses `--quiet`, `--schema`, `--verdict-json`, or any subcommand-level `--json` flag
- the same version was already shown within the last 7 days

To disable update checks entirely:

```bash
# One-off
PHONE_A_FRIEND_UPDATE_CHECK=false phone-a-friend ...

# Permanent
phone-a-friend config set defaults.update_check false
```

The cache lives at `~/.config/phone-a-friend/update-check.json` (or under
`$XDG_CONFIG_HOME` if set). Run `phone-a-friend doctor` to inspect the current
state.

## Backends

| Backend | Type | Streaming |
|---------|------|-----------|
| **Antigravity** | CLI subprocess (`agy`) | No |
| **Codex** | CLI subprocess | No |
| **Gemini** | CLI subprocess | No |
| **Ollama** | HTTP API | Yes (NDJSON) |
| **Claude** | CLI subprocess | Yes (JSON) |
| **OpenCode** | CLI subprocess | Yes (NDJSON) |
| **pi** | CLI subprocess (`pi --mode json`) | Yes (JSONL) |

Ollama configuration via environment variables:
- `OLLAMA_HOST` -- custom host (default: `http://localhost:11434`)
- `OLLAMA_MODEL` -- default model (overridden by `--model` flag)

Claude configuration via TOML:

```toml
[backends.claude]
peer_messaging = "native" # native (default), accept, or refuse
```

Phone-a-friend environment variables:
- `PHONE_A_FRIEND_INCLUDE_DIFF=false` -- disable diff inclusion globally (equivalent to `--no-include-diff` on every call).
- `PHONE_A_FRIEND_CLAUDE_PEER_MESSAGING=native|accept|refuse` -- override Claude peer messaging for the current process.
- `PHONE_A_FRIEND_HOST=opencode|codex|pi` -- mark the calling process as a specific host for the recursion guard. `opencode` blocks `--to opencode`; `codex` blocks `--to codex`; `pi` blocks `--to pi`. Set automatically by the install shims (pi has none; PaF also honours pi's own `PI_CODING_AGENT=true`).
- `CODEX_HOME` -- override the Codex config root (default: `~/.codex`). Honored by the Codex skill installer.
- `PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false` -- bypass the Gemini dead-model cache (debugging stale entries).

Antigravity notes:
- PaF backend name: `antigravity`; executable: `agy`.
- Antigravity is read-only only for now. Plain `--to antigravity` calls resolve
  to `read-only`; explicit write sandboxes such as `--sandbox workspace-write`
  are rejected.
- `--session` and `--backend-session` resume the Antigravity conversation.
- Headless `agy` auto-denies shell commands. PaF prefixes every Antigravity prompt with a notice saying so, which is what makes `--review` and `--verdict-json` work; the model reads files instead of running `git`.
- If Gemini CLI says individual Google sign-in is no longer supported, use `--to antigravity` for the Google subscription path or use Gemini CLI with an API key/Vertex flow.

OpenCode configuration via TOML:
```toml
[backends.opencode]
provider = "ollama"     # model prefix (default: "ollama")
model = "qwen3-coder"   # default model
pure = false             # 1.x only: skip OpenCode plugins (maps to --fast)
standalone = false       # 2.x only: run with a private server instead of the shared background service
```

OpenCode 1.x (`opencode-ai`) and 2.x (`@opencode/cli`) both install as `opencode`
and differ in `run` flags (2.x has no `--dir` or `--pure`). PaF detects the line
from `opencode --version` and adapts; `phone-a-friend doctor` reports 2.x
installs. `standalone` re-boots every configured MCP server per relay, so leave
it off unless you need an isolated server.

pi configuration via TOML (local models served by a provider defined in pi's
`models.json`; tested with an MLX server):
```toml
[backends.pi]
provider = "mlx"                             # a provider from pi's models.json
model = "mlx-community/Qwen3.5-9B-MLX-4bit"   # default model; --model overrides it
```

```bash
phone-a-friend --to pi --prompt "Review src/auth.ts" --fast
phone-a-friend --to pi --review --fast                      # diff-scoped review by a local model
phone-a-friend --to pi --prompt "..." --session local-review # resumable
```

pi notes:
- The sandbox is a tool list, not OS isolation: `read-only` offers the model
  `read,grep,find,ls`, `workspace-write` adds `edit,write`, and
  `danger-full-access` adds `bash`. pi itself runs with your permissions.
- PaF always passes `-ne` and `--no-approve`, so pi extensions and project-local
  pi files are off for the relay. On pi 0.99+ that includes pi's built-in
  extensions (MCP servers, codemode, the llama.cpp provider), so define the
  provider in `models.json`.
- `--fast` skips AGENTS.md/CLAUDE.md and pi skills (`-nc -ns`). Small local
  models have small context windows; use it unless the task depends on project
  conventions.
- Sessions live in `$XDG_CONFIG_HOME/phone-a-friend/pi-sessions` (default
  `~/.config/phone-a-friend/pi-sessions`), not in pi's own store.
  PaF refuses to resume a session whose file is missing instead of letting pi
  start a new one. `--backend-session` cannot attach a session created directly
  in pi. `session delete` and `session prune` remove the PaF label, not the pi
  session file.
- `--schema` is best-effort: the schema goes into the prompt and the answer is
  not validated. `--verdict-json` is validated by PaF and fails closed; a small
  model can fail it where `--fast` or a larger model passes.
- PaF never starts a model server. If the server is down, pi retries for about
  15 seconds and the relay fails with `Connection error.`
- Both batch and streaming runs report tool activity, retries, and context
  compaction as progress. Compaction summaries are never included in progress.
- pi is not an agentic backend. As a host it gets two skills, see [pi skills](#quick-start) above; `/phone-a-team` is not available in pi.

## Streaming

Backends that support streaming deliver tokens as they arrive via `--stream`:

```bash
phone-a-friend --to claude --prompt "Review this code" --stream
```

Streaming is enabled by default in the config (`defaults.stream = true`). Disable with `--no-stream` or `config set defaults.stream false`.

## Agentic Mode

> Let one agent review while another critiques — catching bugs, inconsistencies, and blind spots before you even see the code.

Agentic mode spawns multiple Claude agents that communicate via `@mentions` within a shared session. An orchestrator routes messages between agents, enforces guardrails, and persists the transcript for logs, replay, and TUI browsing.

Each agent accumulates context through persistent CLI sessions — later responses build on earlier ones, so agents develop genuine understanding of the problem as the session progresses.

> [!IMPORTANT]
> **Agentic mode currently supports Claude agents only.** Codex, Gemini, OpenCode, and Ollama agents are not yet wired into the orchestrator. If you need multi-host adversarial review today, use `/phone-a-team` instead — it does parallel multi-backend rounds with the same iterate-or-ship pattern, just without the persistent session graph. See [AGENTS.md](AGENTS.md) for the agentic architecture.

```bash
# Start an agentic session
phone-a-friend agentic run \
  --agents reviewer:claude,critic:claude \
  --prompt "Review the auth module"

# View past sessions and replay transcripts
phone-a-friend agentic logs
phone-a-friend agentic replay --session <id>
```

**What you get:**

- **Persistent sessions** -- agents accumulate context across turns via UUID-based session resumption
- **@mention routing** -- agents address each other by name (`@ada.reviewer:`), broadcast with `@all`, or surface findings with `@user`
- **Guardrails** -- max turns (20), ping-pong detection, session timeout (15 min), turn budget warnings
- **Full audit trail** -- SQLite-backed transcript persistence for replay, logs, and post-session analysis
- **Creative agent naming** -- agents get memorable human names so you can follow the conversation

## Documentation


Full usage guide, examples, CLI reference, and configuration details:

**[freibergergarcia.github.io/phone-a-friend](https://freibergergarcia.github.io/phone-a-friend/)**

## Uninstall

Remove host integrations explicitly while the CLI is still installed, then
remove the global package:

```bash
phone-a-friend plugin uninstall --all
npm uninstall -g @freibergergarcia/phone-a-friend
```

To remove only a pi package installed with pi's own package manager:

```bash
pi remove npm:@freibergergarcia/phone-a-friend
```

Package removal preserves local configuration and history. There is no uninstall
lifecycle hook. Use `phone-a-friend task delete` / `task prune` and `session delete`
/ `session prune` for individual records. For complete PaF data removal, stop
running jobs, back up needed data, and manually delete
`~/.config/phone-a-friend/` (or `$XDG_CONFIG_HOME/phone-a-friend/`). Backend-native
history is managed separately by each backend.

**Claude Code marketplace:**

```
/plugin uninstall phone-a-friend@phone-a-friend-marketplace
/plugin marketplace remove phone-a-friend-marketplace
```

## Contributing

All changes go through pull requests -- no direct pushes to `main`.

1. **Branch off main** using a recognized prefix (see table below)
2. **Open a PR** against `main` -- a version label is auto-applied from the branch name
3. **CI must pass** before merge (includes label check)
4. PRs are **squash-merged** (one commit per change, clean linear history)
5. Head branches are auto-deleted after merge
6. On merge, version is **auto-bumped** based on the label

**Branch prefixes:**

| Prefix | Label |
|--------|-------|
| `fix/`, `bugfix/` | `patch` |
| `chore/`, `docs/`, `ci/`, `refactor/` | `patch` |
| `feat/`, `feature/` | `minor` |
| `breaking/` | `major` |

Unrecognized prefixes require adding `patch`, `minor`, or `major` manually.

## Development

```bash
npm install              # Install dependencies
npm run build            # Build dist/ (tsup)
npm test                 # Run tests (vitest)
npm run typecheck        # Type check (tsc --noEmit)
```

### Test a checkout end to end

Host skills call whatever `phone-a-friend` is on `PATH`, and the marketplace
manifest sources the Claude plugin from npm, so a fresh Claude session will
run the released version even when you are sitting in a modified checkout.
To exercise unreleased changes:

```bash
npm run build && npm link          # global `phone-a-friend` now points at this checkout
phone-a-friend doctor              # confirms PATH resolves to the checkout, no version mismatch
claude --plugin-dir "$PWD"         # loads this checkout's commands/ and skills/ for the session,
                                   # overriding the installed marketplace copy
```

Then ask for a review in that session. `npm install -g @freibergergarcia/phone-a-friend`
restores the released binary. `phone-a-friend plugin install --claude` alone is not
enough for skill changes: it re-registers the marketplace, whose plugin source is npm.

## Privacy

Phone a Friend runs locally and operates no relay service or telemetry collector.
Requests go to your selected backend and its configured provider. Local task,
session and job history is enabled by default; optional update checks contact npm.
See [Privacy and local data](PRIVACY.md) for retention, deletion and network details,
and [Support](SUPPORT.md) for sanitized bug reporting.

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

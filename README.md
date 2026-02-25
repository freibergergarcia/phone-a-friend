<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/logo-light.svg">
    <img alt="phone-a-friend" src="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/logo-dark.svg" width="480">
  </picture>

  <p><em>When your AI needs a second opinion.</em></p>

  [![npm](https://img.shields.io/npm/v/%40freibergergarcia%2Fphone-a-friend)](https://www.npmjs.com/package/@freibergergarcia/phone-a-friend)
  [![CI](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml/badge.svg)](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/github/license/freibergergarcia/phone-a-friend)](LICENSE)
  ![Node.js 20+](https://img.shields.io/badge/node-%E2%89%A520.12-green)
  [![Website](https://img.shields.io/badge/website-phone--a--friend-blue)](https://freibergergarcia.github.io/phone-a-friend/)

</div>

`phone-a-friend` is a CLI orchestration layer for AI coding agents.
Relay tasks to any backend, spin up multi-model teams, or run persistent multi-agent sessions with a live web dashboard.

| Mode | What it does | Best for |
|------|-------------|----------|
| **Relay** | One-shot delegation to Codex, Gemini, Ollama, or Claude | Quick second opinions, code reviews, analysis |
| **Team** | Iterative multi-backend refinement over N rounds | Collaborative review, converging on a solution |
| **Agentic** | Persistent multi-agent sessions with @mention routing | Autonomous collaboration, adversarial review, deep analysis |

<div align="center">

### TUI Dashboard

<img src="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/tui-dashboard.png" alt="TUI dashboard" width="600">

### Web Dashboard

<img src="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/web-dashboard.gif" alt="Web dashboard" width="700">

</div>

## Quick Start

**Prerequisites:** Node.js 20+ and at least one backend:

```bash
npm install -g @openai/codex       # Codex CLI
npm install -g @google/gemini-cli  # Gemini CLI
# Ollama: https://ollama.com/download (local HTTP API)
npm install -g @anthropic-ai/claude-code  # Claude Code CLI
```

**Install globally via npm:**

```bash
npm install -g @freibergergarcia/phone-a-friend
phone-a-friend plugin install --claude
```

**Or install from source:**

```bash
git clone https://github.com/freibergergarcia/phone-a-friend.git
cd phone-a-friend
npm install && npm run build
./dist/index.js plugin install --claude
```

**Verify your setup:**

```bash
phone-a-friend doctor         # Check which backends are available
phone-a-friend setup          # Interactive wizard (guided config)
```

Then from Claude Code, just talk naturally — the plugin loads the skills automatically:

```
Ask Gemini to review the error handling in relay.ts

Spin up Codex and Gemini to review the docs.
Then spin another agent to review their reviews and report back.

Build a team with Claude and Ollama. Have them review the website copy,
loop through 3 rounds, and converge on final suggestions.
```

No slash commands needed — Claude picks up the skills once the plugin is installed. Mention one backend and it routes through `phone-a-friend`; mention multiple and it spins up `phone-a-team` automatically. You can also use `/phone-a-friend` or `/phone-a-team` explicitly if you prefer.

## CLI Usage

### Relay

Delegate a task to any backend and get the result back:

```bash
phone-a-friend --to codex --prompt "Review this code"
phone-a-friend --to gemini --prompt "Analyze the architecture" --model gemini-2.5-flash
phone-a-friend --to claude --prompt "Refactor this module"
phone-a-friend --to ollama --prompt "Explain this function"
phone-a-friend --to claude --prompt "Review this code" --stream   # Stream tokens live
```

### Review

Context-aware code reviews — automatically pulls the current `git diff` so you don't have to paste code:

```bash
phone-a-friend --to claude --review               # Review current diff
phone-a-friend --to codex --review --base develop  # Review against a specific branch
```

### Agentic

Spawn multiple agents that collaborate via @mentions (see [Agentic Mode](#agentic-mode) below):

```bash
phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "Review this code"
phone-a-friend agentic logs               # View past sessions
phone-a-friend agentic replay --session <id>  # Replay transcript
phone-a-friend agentic dashboard           # Launch web dashboard (localhost:7777)
```

### Ops

```bash
phone-a-friend                 # Interactive TUI dashboard (TTY only)
phone-a-friend setup           # Guided setup wizard
phone-a-friend doctor          # Health check all backends
phone-a-friend config show     # Show resolved config
phone-a-friend config edit     # Open in $EDITOR
phone-a-friend plugin install --claude   # Install as Claude Code plugin
```

## Backends

| Backend | Type | Streaming | How it works |
|---------|------|-----------|-------------|
| **Codex** | CLI subprocess | No | Runs `codex exec` with sandbox and repo context |
| **Gemini** | CLI subprocess | No | Runs `gemini --prompt` with `--yolo` auto-approve |
| **Ollama** | HTTP API | Yes (NDJSON) | POSTs to `localhost:11434/api/chat` via native fetch |
| **Claude** | CLI subprocess | Yes (JSON) | Runs `claude` with sandbox-to-tool mapping |

Ollama configuration via environment variables:
- `OLLAMA_HOST` -- custom host (default: `http://localhost:11434`)
- `OLLAMA_MODEL` -- default model (overridden by `--model` flag)

## Streaming

Backends that support streaming deliver tokens as they arrive via `--stream`:

```bash
phone-a-friend --to claude --prompt "Review this code" --stream
```

Streaming is enabled by default in the config (`defaults.stream = true`). Disable with `--no-stream` or `config set defaults.stream false`.

## Agentic Mode

> Let one agent review while another critiques — catching bugs, inconsistencies, and blind spots before you even see the code.

Agentic mode spawns multiple Claude agents that communicate via `@mentions` within a shared session. An orchestrator routes messages between agents, enforces guardrails, and streams every event to a **live web dashboard** where you can watch the collaboration in real time.

Each agent accumulates context through persistent CLI sessions — later responses build on earlier ones, so agents develop genuine understanding of the problem as the session progresses.

**Currently supports Claude agents only.** See [AGENTS.md](AGENTS.md) for full architecture details.

```bash
# Start an agentic session
phone-a-friend agentic run \
  --agents reviewer:claude,critic:claude \
  --prompt "Review the auth module"

# View past sessions and replay transcripts
phone-a-friend agentic logs
phone-a-friend agentic replay --session <id>

# Launch web dashboard (real-time session visualization)
phone-a-friend agentic dashboard              # default: localhost:7777
phone-a-friend agentic dashboard --port 8080
```

**How it works:**

1. The orchestrator spawns each agent with the initial prompt and a unique name (e.g., `ada.reviewer`, `fern.critic`)
2. Agents respond and `@mention` other agents (or `@all` / `@user`)
3. The orchestrator routes messages to the targeted agents
4. Agents reply in subsequent turns, building on accumulated context
5. The session ends when agents converge (no new messages), hit the turn limit, or time out

**What you get:**

- **Live web dashboard** -- watch agents collaborate in real time at `localhost:7777` (SSE-powered)
- **Persistent sessions** -- agents accumulate context across turns via UUID-based session resumption
- **@mention routing** -- agents address each other by name (`@ada.reviewer:`), broadcast with `@all`, or surface findings with `@user`
- **Guardrails** -- max turns (20), ping-pong detection, session timeout (15 min), turn budget warnings
- **Full audit trail** -- SQLite-backed transcript persistence for replay, logs, and post-session analysis
- **Creative agent naming** -- agents get memorable human names so you can follow the conversation

## Documentation

Full usage guide, examples, CLI reference, and configuration details:

**[freibergergarcia.github.io/phone-a-friend](https://freibergergarcia.github.io/phone-a-friend/)**

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

## License

MIT. See `LICENSE`.

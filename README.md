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

`phone-a-friend` is a CLI relay that lets AI coding agents collaborate. Claude delegates tasks -- code reviews, file edits, analysis, refactoring -- to a backend AI (Codex, Gemini, Ollama, or Claude) and brings the results back into the current session.

```
  Claude --> phone-a-friend --> Codex / Gemini / Ollama / Claude     (one-shot relay)
  Claude --> phone-a-friend --stream --> stream tokens live           (streaming)
  Claude --> phone-a-team --> iterate with backend(s)                 (iterative refinement)
```

<div align="center">
  <img src="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/tui-dashboard.png" alt="phone-a-friend TUI dashboard" width="680">
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

```bash
# Relay to a backend
phone-a-friend --to codex --prompt "Review this code"
phone-a-friend --to gemini --prompt "Analyze the architecture" --model gemini-2.5-flash
phone-a-friend --to claude --prompt "Refactor this module"
phone-a-friend --to ollama --prompt "Explain this function"

# Stream responses in real time
phone-a-friend --to codex --prompt "Review this code" --stream

# Interactive TUI dashboard (launch with no args in a terminal)
phone-a-friend

# Setup & diagnostics
phone-a-friend setup          # Interactive setup wizard
phone-a-friend doctor         # Health check all backends
phone-a-friend doctor --json  # Machine-readable health check

# Configuration (TOML)
phone-a-friend config init    # Create default config
phone-a-friend config show    # Show resolved config
phone-a-friend config edit    # Open in $EDITOR

# Plugin management
phone-a-friend plugin install --claude
phone-a-friend plugin update --claude
phone-a-friend plugin uninstall --claude
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
phone-a-friend --to codex --prompt "Review this code" --stream
```

Streaming is enabled by default in the config (`defaults.stream = true`). Disable with `--no-stream` or `config set defaults.stream false`.

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

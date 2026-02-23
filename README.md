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

`phone-a-friend` is a CLI relay that lets AI coding agents collaborate. Claude delegates tasks -- code reviews, file edits, analysis, refactoring -- to a backend AI (Codex, Gemini, or Ollama) and brings the results back into the current session.

```
  Claude --> phone-a-friend --> Codex / Gemini / Ollama     (one-shot relay)
  Claude --> phone-a-team --> iterate with backend(s)        (iterative refinement)
```

<div align="center">
  <img src="https://raw.githubusercontent.com/freibergergarcia/phone-a-friend/main/assets/tui-dashboard.png" alt="phone-a-friend TUI dashboard" width="680">
</div>

## Quick Start

**Prerequisites:** Node.js 20+ and at least one backend:

```bash
npm install -g @openai/codex       # Codex CLI
npm install -g @google/gemini-cli  # Gemini CLI (or both)
# Ollama: https://ollama.com/download (local HTTP API, no npm needed)
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

Then from Claude Code:

```
/phone-a-friend Ask codex to review the error handling in relay.ts
/phone-a-team Refactor the backend registry for extensibility
```

## CLI Usage

```bash
# Relay to a backend
phone-a-friend --to codex --prompt "Review this code"
phone-a-friend --to gemini --prompt "Analyze the architecture" --model gemini-2.5-flash
phone-a-friend --to ollama --prompt "Explain this function"

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

| Backend | Type | How it works |
|---------|------|-------------|
| **Codex** | CLI subprocess | Runs `codex exec` with sandbox and repo context |
| **Gemini** | CLI subprocess | Runs `gemini --prompt` with `--yolo` auto-approve |
| **Ollama** | HTTP API | POSTs to `localhost:11434/api/chat` via native fetch |

Ollama configuration via environment variables:
- `OLLAMA_HOST` -- custom host (default: `http://localhost:11434`)
- `OLLAMA_MODEL` -- default model (overridden by `--model` flag)

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

<div align="center">

# ☎️ phone-a-friend

*Let your AI coding agent phone a friend.*

[![CI](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml/badge.svg)](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/freibergergarcia/phone-a-friend)](LICENSE)
![Python 3.10+](https://img.shields.io/badge/python-%E2%89%A53.10-blue)

</div>

`phone-a-friend` is a CLI relay that lets AI coding agents collaborate. Claude delegates tasks — code reviews, file edits, analysis, refactoring — to a backend AI (Codex or Gemini) and brings the results back into the current session. Works as a Claude Code slash command (`/phone-a-friend`) and as a standalone CLI.

```
  Claude ──> phone-a-friend ──> Codex / Gemini
  Claude <── phone-a-friend <── Codex / Gemini
```

## Quick Start

**Prerequisites:** Python 3.10+ and at least one backend CLI installed:

```bash
npm install -g @openai/codex    # Codex backend
npm install -g @google/gemini-cli  # Gemini backend (or both)
```

```bash
# 1. Clone
git clone https://github.com/freibergergarcia/phone-a-friend.git
cd phone-a-friend

# 2. Install as Claude Code plugin
./phone-a-friend install --claude

# 3. Use from Claude Code
#    /phone-a-friend Review this code for bugs

# 4. Or use from the command line
./phone-a-friend --to codex --repo . --prompt "Review this implementation"
```

## Features

- **Pluggable backends** — Codex and Gemini today; add your own by implementing `RelayBackend`
- **Context-aware** — sends repo path, optional `git diff`, and extra context (file or inline text)
- **Sandboxed execution** — `read-only` (default), `workspace-write`, or `danger-full-access`
- **Depth guard** — `PHONE_A_FRIEND_DEPTH` env var prevents infinite nested relay loops
- **Size limits** — context (200 KB), diff (300 KB), and prompt (500 KB) caps enforced before relay
- **Zero dependencies** — pure Python 3.10+, no pip install required

## Requirements

- Python 3.10+
- At least one backend CLI in `PATH`:
  - [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli`

## Installation

Install as a Claude plugin:

```bash
./phone-a-friend install --claude
```

Update an existing installation:

```bash
./phone-a-friend update
```

Uninstall:

```bash
./phone-a-friend uninstall --claude
```

- `--mode symlink|copy` — installation mode (default: `symlink`)
- `--force` — replace existing installation
- `--no-claude-cli-sync` — skip Claude CLI marketplace sync

## Usage

Both `./phone-a-friend relay ...` and `./phone-a-friend --prompt ...` syntaxes work.

Ask a backend to review code:

```bash
./phone-a-friend --to codex --repo /path/to/repo --prompt "Review this implementation for bugs and security issues."
```

Delegate a task with write access:

```bash
./phone-a-friend --to gemini --repo /path/to/repo \
  --prompt "Add error handling to the API endpoints." \
  --sandbox workspace-write
```

Review changes with diff:

```bash
./phone-a-friend --to codex --repo /path/to/repo \
  --prompt "Review these changes and suggest improvements." \
  --include-diff
```

Pass additional context:

```bash
./phone-a-friend --to gemini --repo /path/to/repo \
  --prompt "Refactor this module following the pattern described." \
  --context-file /path/to/design-notes.txt
```

### Options

| Flag | Description |
|------|-------------|
| `--to` | Backend name (`codex` or `gemini`) |
| `--repo` | Repository path sent to the backend |
| `--prompt` | The prompt to relay (required) |
| `--context-file` | File with additional context |
| `--context-text` | Inline context (mutually exclusive with `--context-file`) |
| `--include-diff` | Append `git diff` from `--repo` |
| `--timeout` | Timeout in seconds (default `600`) |
| `--model` | Model override |
| `--sandbox` | Sandbox mode: `read-only` (default), `workspace-write`, `danger-full-access` |

## Privacy

`phone-a-friend` sends to the selected backend (Codex or Gemini): your prompt, optional context text/file, optional `git diff`, and the repository path. The backend CLI also has read access to files under `--repo`. Review your inputs and repository contents before relaying sensitive data.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## License

MIT. See `LICENSE`.

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
#    /phone-a-friend Ask codex to review this code for bugs

# 4. Or use from the command line
./phone-a-friend --to codex --repo . --prompt "Review this implementation"
```

## Examples

**Ask Codex to review a module:**

    ❯ /phone-a-friend Ask codex to review the error handling in relay.py

    ⏺ Skill(phone-a-friend)
      ⎿  Successfully loaded skill

    ⏺ Bash(./phone-a-friend --to codex --repo "$PWD" --prompt "Review the error handling in relay.py")
      ⎿  The subprocess timeout is caught and re-raised as RelayError, but
         the original stderr is silently discarded. Consider logging it.
         The depth-guard in _check_depth() correctly prevents infinite
         recursion. No critical issues found.

    ⏺ Codex found no critical issues. One suggestion: preserve stderr
      when re-raising timeout errors for easier debugging.

**Ask Codex to review recent changes:**

    ❯ /phone-a-friend Ask codex to review my recent changes for issues

    ⏺ Skill(phone-a-friend)
      ⎿  Successfully loaded skill

    ⏺ Bash(./phone-a-friend --to codex --repo "$PWD" --include-diff --prompt "Review my recent changes for issues")
      ⎿  The diff adds a --model flag and threads it through to the
         backend. Looks correct. One nit: the new flag is missing from
         the README options table.

    ⏺ Codex approved the changes with one nit — the --model flag needs
      a row in the README options table.

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

### Recommended — via Claude Code

Use the slash command with natural language:

```
/phone-a-friend Ask codex to review the error handling in relay.py
/phone-a-friend Ask codex to add input validation to the submit handler
/phone-a-friend Ask codex to refactor the backend registry for extensibility
/phone-a-friend Ask codex to review my recent changes for issues
```

### CLI flags

For standalone use, scripting, or to select a different backend:

```bash
./phone-a-friend --to codex --repo . --prompt "Review this implementation"
./phone-a-friend --to gemini --repo . --prompt "Add error handling" --sandbox workspace-write
./phone-a-friend --to codex --repo . --prompt "Review changes" --include-diff
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

## Contributing

All changes go through pull requests — no direct pushes to `main`.

1. **Branch off main** using a prefix: `feature/`, `fix/`, `improve/`, or `chore/`
2. **Open a PR** against `main`
3. **CI must pass** before merge
4. PRs are **squash-merged** (one commit per change, clean linear history)
5. Head branches are auto-deleted after merge

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## License

MIT. See `LICENSE`.

# phone-a-friend

A CLI relay that lets AI coding agents collaborate. Claude can delegate tasks to another AI backend (Codex or Gemini) — ask it to review code, make file changes, run analysis, or anything else the backend supports — and bring the results back into the current session.

> **Current direction:** Claude → backend only. Backends cannot yet initiate requests back to Claude.

## What It Does

- Delegates any task to a backend AI: code reviews, file edits, analysis, refactoring, and more
- Sends prompts with optional repository context and `git diff` for full codebase awareness
- Returns the backend's response (and any file changes it made) for Claude to incorporate
- Enforces payload size limits, timeout handling, and a depth guard (`PHONE_A_FRIEND_DEPTH`) to prevent nested loops
- Supports sandboxed execution: `read-only` (default), `workspace-write`, or `danger-full-access`
- Backend-agnostic core with pluggable backends

## Requirements

- Python 3
- At least one supported backend CLI installed and available in `PATH`:
  - [Codex CLI](https://github.com/openai/codex) (must support `exec`, `--sandbox`, and `--output-last-message`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (must support `--prompt`, `--sandbox`, and `--yolo`)
- No external Python dependencies required

## Install

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

Install supports `--mode symlink|copy` (default `symlink`) and `--force`. By default it also syncs with the Claude CLI marketplace. Use `--no-claude-cli-sync` to skip that.

## Usage

Both relay syntaxes are supported: `./phone-a-friend relay ...` and `./phone-a-friend --prompt ...`.

Ask a backend to review code:

```bash
./phone-a-friend --to codex --repo /path/to/repo --prompt "Review this implementation for bugs and security issues."
```

Delegate a task with context:

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

`phone-a-friend` sends to the selected backend (Codex or Gemini): your prompt, optional context text/file, optional `git diff`, and the repository path. Review your inputs before relaying sensitive data.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## License

MIT. See `LICENSE`.

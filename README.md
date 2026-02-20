# phone-a-friend

A CLI relay that lets Claude ask Codex for a second opinion. Claude sends a prompt plus optional repository context to Codex and gets back Codex's response.

> **Current direction:** Claude → Codex only. Codex cannot yet initiate requests back to Claude.

## What It Does

- Relays a prompt (with optional context and `git diff`) from Claude to Codex
- Returns Codex's final response for Claude to incorporate
- Enforces payload size limits, timeout handling, and a depth guard (`PHONE_A_FRIEND_DEPTH`) to prevent nested loops
- Backend-agnostic core — additional backends can be added later

## Requirements

- Python 3
- [Codex CLI](https://github.com/openai/codex) installed and available in `PATH` (must support `exec`, `--sandbox`, and `--output-last-message`)
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

Basic relay:

```bash
./phone-a-friend --to codex --repo /path/to/repo --prompt "Review this implementation."
```

With inline context:

```bash
./phone-a-friend --to codex --repo /path/to/repo \
  --prompt "Review this output." \
  --context-text "Short context here."
```

With a context file and diff:

```bash
./phone-a-friend --to codex --repo /path/to/repo \
  --prompt "Review this plan." \
  --context-file /path/to/context.txt \
  --include-diff
```

### Options

| Flag | Description |
|------|-------------|
| `--to` | Backend name (currently `codex`) |
| `--repo` | Repository path sent to the backend |
| `--prompt` | The prompt to relay (required) |
| `--context-file` | File with additional context |
| `--context-text` | Inline context (mutually exclusive with `--context-file`) |
| `--include-diff` | Append `git diff` from `--repo` |
| `--timeout` | Timeout in seconds (default `600`) |
| `--model` | Model override |
| `--sandbox` | Sandbox mode: `read-only` (default), `workspace-write`, `danger-full-access` |

## Privacy

`phone-a-friend` sends to Codex: your prompt, optional context text/file, optional `git diff`, and the repository path. Review your inputs before relaying sensitive data.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## License

MIT. See `LICENSE`.

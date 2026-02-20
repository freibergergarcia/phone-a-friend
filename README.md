# phone-a-friend

`phone-a-friend` is a standalone cross-agent relay CLI. It sends a prompt plus optional repository context to Codex and returns Codex's final response.

## What It Does

- Assembles a relay prompt with optional context text/file and optional `git diff`
- Enforces payload size limits and timeout handling
- Uses a depth guard to prevent nested relay loops (`PHONE_A_FRIEND_DEPTH`)
- Writes/reads Codex final output via `--output-last-message` with stdout fallback
- Keeps relay core backend-agnostic so additional backends can be added later

## Backend Architecture

- Core relay logic lives in `phone_a_friend/relay.py`
- Backend interface + registry live in `phone_a_friend/backends/__init__.py`
- Codex backend lives in `phone_a_friend/backends/codex.py`

Current backend:
- `codex`

Codex command contract:
- `codex exec -C <repo> --skip-git-repo-check --sandbox <mode> --output-last-message <file> <prompt>`

## Requirements

- Python 3
- Codex CLI installed and available in `PATH`
- Codex version must support `exec`, `--sandbox`, and `--output-last-message`

No external Python dependencies are required.

## Install / Run

From repo root:

```bash
./phone-a-friend --help
./phone-a-friend relay --help
./phone-a-friend install --help
./phone-a-friend update --help
./phone-a-friend uninstall --help
```

If `typer` is installed, the CLI uses it. If not, it automatically falls back to stdlib `argparse`.

Install plugin into Claude:

```bash
./phone-a-friend install --claude
# alias:
./phone-a-friend install --all
```

Update installed Claude plugin (forced reinstall):

```bash
./phone-a-friend update
```

Uninstall from Claude:

```bash
./phone-a-friend uninstall --claude
# alias:
./phone-a-friend uninstall --all
```

Notes:
- `install` supports `--mode symlink|copy` (default `symlink`) and `--force`.
- `update` is equivalent to `install --claude --force`.
- By default it also runs Claude CLI sync steps (`marketplace add/update`, `install`, `enable`, `update`).
- Use `--no-claude-cli-sync` if you only want filesystem install into `~/.claude/plugins/phone-a-friend`.
- Relay execution includes Codex `--skip-git-repo-check`, so non-git directories are supported.

## Usage

Basic relay:

```bash
./phone-a-friend \
  relay \
  --to codex \
  --repo /path/to/repo \
  --prompt "Review the current implementation and list critical issues."
```

Root compatibility (implicitly routes to `relay`):

```bash
./phone-a-friend \
  --to codex \
  --repo /path/to/repo \
  --prompt "Review the current implementation and list critical issues."
```

With inline context:

```bash
./phone-a-friend \
  relay \
  --to codex \
  --repo /path/to/repo \
  --prompt "Review this output for correctness." \
  --context-text "Paste short context directly here."
```

With context file and diff:

```bash
./phone-a-friend \
  relay \
  --to codex \
  --repo /path/to/repo \
  --prompt "Review this plan for gaps." \
  --context-file /path/to/context.txt \
  --include-diff
```

Options:

- `--to` backend name (`codex`)
- `--repo` repository path sent to backend
- `--prompt` required prompt
- `--context-file` optional file context
- `--context-text` optional inline context (mutually exclusive with `--context-file`)
- `--include-diff` append `git diff` from `--repo`
- `--timeout` timeout in seconds (default `600`)
- `--model` optional model override
- `--sandbox` backend sandbox mode (default `read-only`)

Compatibility:
- `./phone-a-friend --prompt "..." --repo ...` still works (implicitly routed to `relay`).

## Privacy / Data Exposure

`phone-a-friend` sends the following to Codex:

- The prompt you provide
- Optional context text/file contents
- Optional `git diff` output when `--include-diff` is enabled
- Repository path via `-C`

Review your prompt/context carefully before relaying sensitive data.

## Tests

Run all tests:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## License

MIT. See `LICENSE`.

## Project Layout

```text
phone-a-friend/
  phone-a-friend
  .claude-plugin/plugin.json
  commands/phone-a-friend.md
  phone_a_friend/
    __init__.py
    cli.py
    relay.py
    backends/
      __init__.py
      codex.py
  tests/
    test_cli.py
    test_relay.py
```

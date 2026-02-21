# AGENTS.md

Guidance for AI coding agents working in `phone-a-friend`.

## What This Is

`phone-a-friend` is a standalone CLI for relaying prompts + repository context to Codex.

## Core Behavior

- Relay core is backend-agnostic in `phone_a_friend/relay.py`
- Backend interface/registry in `phone_a_friend/backends/__init__.py`
- Codex backend in `phone_a_friend/backends/codex.py`
- Depth guard env var: `PHONE_A_FRIEND_DEPTH`
- Default sandbox: `read-only`

## CLI Contract

```bash
./phone-a-friend --to codex --repo <path> --prompt "..."
```

Claude install commands:

```bash
./phone-a-friend install --claude
./phone-a-friend update
./phone-a-friend uninstall --claude
```

Codex invocation contract:

```bash
codex exec -C <repo> --skip-git-repo-check --sandbox <mode> --output-last-message <file> <prompt>
```

## Running Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## Versioning

- Source of truth: `version` in `pyproject.toml`
- Must keep in sync: `.claude-plugin/plugin.json` `version` field (CI enforces this)
- Runtime access: `phone_a_friend.__version__` (via `importlib.metadata`)
- CLI: `./phone-a-friend --version`
- **Auto-release**: merging to `main` with a new version automatically creates a git tag and GitHub Release
- To release: bump version in both `pyproject.toml` and `.claude-plugin/plugin.json`, merge to `main`

### When to bump

**Every PR must bump the version.** Update both `pyproject.toml` and `.claude-plugin/plugin.json` before merging.

- **Patch** (`0.1.0` → `0.1.1`): bug fixes, docs, CI changes, refactoring
- **Minor** (`0.1.0` → `0.2.0`): new features, new CLI flags, new backends
- **Major** (`0.2.0` → `1.0.0`): breaking changes to CLI contract or relay API

## Scope

This repository only contains relay functionality. Policy engines, hooks, approvals, trusted scripts, and installer logic are intentionally out of scope.

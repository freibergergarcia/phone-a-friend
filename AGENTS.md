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
- To release: update version in both files, merge, then `git tag vX.Y.Z && git push origin vX.Y.Z`

## Scope

This repository only contains relay functionality. VIPGO policy engine, hooks, approvals, trusted scripts, and installer logic are intentionally out of scope.

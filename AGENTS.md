# AGENTS.md

Guidance for AI coding agents working in `phone-a-friend`.

## What This Is

`phone-a-friend` is a TypeScript CLI for relaying prompts + repository context to coding backends (Claude, Codex, Gemini, Ollama). Available via `npm install -g @freibergergarcia/phone-a-friend` or from source. All backend `run()` methods are async (`Promise<string>`). Backends may also implement `runStream()` returning `AsyncIterable<string>` for token-level streaming.

## Project Structure

```
src/
  index.ts           Entry point — imports backends, runs CLI
  cli.ts             Commander.js CLI with subcommands
  relay.ts           Backend-agnostic relay core (relay + relayStream)
  stream-parsers.ts  Stream parsers — SSE (OpenAI-compatible), NDJSON (Ollama), Claude JSON snapshots
  context.ts         RelayContext interface
  version.ts         Shared version reader
  detection.ts       Backend detection (CLI, Local, Host)
  config.ts          TOML configuration system
  doctor.ts          Health check command
  setup.ts           Interactive setup wizard
  installer.ts       Claude plugin installer (symlink/copy)
  backends/
    index.ts         Backend interface, registry, types
    claude.ts        Claude CLI subprocess backend (`claude -p`)
    codex.ts         Codex subprocess backend
    gemini.ts        Gemini subprocess backend
    ollama.ts        Ollama HTTP API backend (native fetch)
  tui/
    App.tsx          Root TUI component — tab bar + panel routing
    render.tsx       Ink render entry point
    StatusPanel.tsx  System info + backend detection display
    BackendsPanel.tsx Per-backend list with detail pane
    ConfigPanel.tsx  Config view + inline editing
    ActionsPanel.tsx Async-wrapped executable actions
    hooks/
      useDetection.ts    Async detection with throttled refresh
      usePluginStatus.ts Plugin install status (sync FS check)
    components/
      TabBar.tsx             Tab navigation bar
      PluginStatusBar.tsx    Persistent plugin install indicator
      Badge.tsx              Status badges (✓ ✗ ! ·)
      KeyHint.tsx            Footer keyboard hints
      ListSelect.tsx         Scrollable selectable list
tests/               Vitest tests (mirrors src/ structure)
dist/                Built bundle (committed, self-contained)
```

## Core Behavior

- Relay core is backend-agnostic in `src/relay.ts` — `relay()` for batch, `relayStream()` for streaming
- Backend interface/registry in `src/backends/index.ts` — `run()` required, `runStream()` optional
- Backend `localFileAccess: boolean` property — controls whether repo path is passed or file contents are inlined
- Claude backend in `src/backends/claude.ts` (subprocess via `claude -p`, streams via `--output-format stream-json`)
- Codex backend in `src/backends/codex.ts`
- Gemini backend in `src/backends/gemini.ts`
- Ollama HTTP backend in `src/backends/ollama.ts` (fetch to localhost:11434)
- Stream parsers in `src/stream-parsers.ts` — SSE (OpenAI-compatible), NDJSON (Ollama), Claude JSON snapshots
- Backend detection (CLI + Local + Host) in `src/detection.ts`
- TOML config system in `src/config.ts` — `defaults.stream = true` enables streaming by default
- Depth guard env var: `PHONE_A_FRIEND_DEPTH`
- Default sandbox: `read-only`

## CLI Contract

After `npm install -g @freibergergarcia/phone-a-friend`, the `phone-a-friend` command is available globally. From the repo root, `./phone-a-friend` also works.

```bash
# Relay
phone-a-friend --to codex --repo <path> --prompt "..."
phone-a-friend --to claude --repo <path> --prompt "..."
phone-a-friend --to gemini --repo <path> --prompt "..." --model gemini-2.5-flash
phone-a-friend --to ollama --repo <path> --prompt "..." --model qwen3
phone-a-friend --prompt "..."               # Uses default backend from config
phone-a-friend --to codex --prompt "..." --stream     # Stream tokens as they arrive
phone-a-friend --to claude --prompt "..." --no-stream  # Disable streaming (batch mode)

# Setup & diagnostics
phone-a-friend setup                        # Interactive setup wizard
phone-a-friend doctor                       # Health check (human-readable)
phone-a-friend doctor --json                # Health check (machine-readable)

# Configuration
phone-a-friend config init                  # Create default config
phone-a-friend config show                  # Show resolved config
phone-a-friend config paths                 # Show config file paths
phone-a-friend config set <key> <value>     # Set a value (dot-notation)
phone-a-friend config get <key>             # Get a value
phone-a-friend config edit                  # Open in $EDITOR

# Plugin management
phone-a-friend plugin install --claude      # Install as Claude plugin
phone-a-friend plugin update --claude       # Update Claude plugin
phone-a-friend plugin uninstall --claude    # Uninstall Claude plugin
```

Backward-compatible aliases: `install`, `update`, `uninstall` still work.

### Interactive TUI

```bash
phone-a-friend                                # Launches TUI dashboard (TTY only)
```

No-args in a TTY launches a full-screen Ink (React) dashboard with 4 tabs:
- **Status** — system info + live backend detection (auto-refreshes)
- **Backends** — navigable backend list with detail pane
- **Config** — inline config editing with focus model (nav/edit modes)
- **Actions** — async-wrapped actions (re-detect, reinstall plugin, open config)

A persistent plugin status bar sits between the tab bar and panel content,
showing `✓ Claude Plugin: Installed` (green) or `! Claude Plugin: Not Installed` (yellow).
It updates instantly after Reinstall/Uninstall actions complete.

TTY guard: non-interactive terminals fall back to help/setup nudge.
Global keys: `q` quit, `Tab`/`1-4` switch tabs, `r` refresh detection.

## Running Tests

```bash
npm test                  # vitest run
npm run typecheck         # tsc --noEmit
npm run build             # tsup (rebuilds dist/)
```

## Versioning

- Source of truth: `version` in `package.json`
- Must keep in sync: `.claude-plugin/plugin.json` `version` field (CI enforces this)
- Runtime access: reads `package.json` via `src/version.ts`
- CLI: `phone-a-friend --version`
- **Auto-bump**: version is bumped automatically after merge based on PR labels
- **Auto-release**: merging to `main` with a new version automatically creates a git tag and GitHub Release
- **npm publish**: after auto-release, publish to npm with `npm publish` (manual step, requires `npm login`)

### PR labels

**Every PR must have exactly one version label: `patch`, `minor`, or `major`.** The `label-check` CI job enforces this. Do NOT modify version fields in `package.json` or `.claude-plugin/plugin.json` manually — they are bumped automatically on merge by the `auto-bump` workflow.

- **`patch`**: bug fixes, docs, CI changes, refactoring
- **`minor`**: new features, new CLI flags, new backends
- **`major`**: breaking changes to CLI contract or relay API

### Branch naming convention

Labels are auto-applied by the `auto-label` workflow when a PR is opened, based on the branch name prefix:

| Prefix | Label |
|--------|-------|
| `fix/`, `bugfix/` | `patch` |
| `chore/`, `docs/`, `ci/`, `refactor/` | `patch` |
| `feat/`, `feature/` | `minor` |
| `breaking/` | `major` |

Unrecognized prefixes get no label — the contributor must add one manually. `label-check` blocks merge until a label is present.

Local manual bump (if needed): `npm run bump:patch`, `npm run bump:minor`, `npm run bump:major`

## Build

`dist/` is committed to git for symlink plugin installs. It must stay self-contained (runs without `node_modules/`). CI verifies this.

After changing source: `npm run build && git add dist/`

## Configuration

Config files (TOML format):
- User: `~/.config/phone-a-friend/config.toml`
- Repo: `.phone-a-friend.toml` (optional, merges over user config)

Precedence: CLI flags > env vars > repo config > user config > defaults

## Scope

This repository contains relay functionality, backend detection, configuration system, Claude plugin installer, and interactive TUI dashboard. Policy engines, hooks, approvals, and trusted scripts are intentionally out of scope.

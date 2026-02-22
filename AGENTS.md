# AGENTS.md

Guidance for AI coding agents working in `phone-a-friend`.

## What This Is

`phone-a-friend` is a TypeScript CLI for relaying prompts + repository context to coding backends (Codex, Gemini, Ollama, OpenAI, Google, Anthropic).

## Project Structure

```
src/
  index.ts           Entry point — imports backends, runs CLI
  cli.ts             Commander.js CLI with subcommands
  relay.ts           Backend-agnostic relay core
  context.ts         RelayContext interface
  version.ts         Shared version reader
  detection.ts       Three-category backend detection
  config.ts          TOML configuration system
  doctor.ts          Health check command
  setup.ts           Interactive setup wizard
  installer.ts       Claude plugin installer (symlink/copy)
  backends/
    index.ts         Backend interface, registry, types
    codex.ts         Codex subprocess backend
    gemini.ts        Gemini subprocess backend
  tui/
    App.tsx          Root TUI component — tab bar + panel routing
    render.tsx       Ink render entry point
    StatusPanel.tsx  System info + backend detection display
    BackendsPanel.tsx Per-backend list with detail pane
    ConfigPanel.tsx  Config view + inline editing
    ActionsPanel.tsx Async-wrapped executable actions
    hooks/
      useDetection.ts  Async detection with throttled refresh
    components/
      TabBar.tsx     Tab navigation bar
      Badge.tsx      Status badges (✓ ✗ ! ·)
      KeyHint.tsx    Footer keyboard hints
      ListSelect.tsx Scrollable selectable list
tests/               Vitest tests (mirrors src/ structure)
dist/                Built bundle (committed, self-contained)
```

## Core Behavior

- Relay core is backend-agnostic in `src/relay.ts`
- Backend interface/registry in `src/backends/index.ts`
- Codex backend in `src/backends/codex.ts`
- Gemini backend in `src/backends/gemini.ts`
- Three-category backend detection in `src/detection.ts`
- TOML config system in `src/config.ts`
- Depth guard env var: `PHONE_A_FRIEND_DEPTH`
- Default sandbox: `read-only`

## CLI Contract

```bash
# Relay
./phone-a-friend --to codex --repo <path> --prompt "..."
./phone-a-friend --to gemini --repo <path> --prompt "..." --model gemini-2.5-flash
./phone-a-friend --prompt "..."               # Uses default backend from config

# Setup & diagnostics
./phone-a-friend setup                        # Interactive setup wizard
./phone-a-friend doctor                       # Health check (human-readable)
./phone-a-friend doctor --json                # Health check (machine-readable)

# Configuration
./phone-a-friend config init                  # Create default config
./phone-a-friend config show                  # Show resolved config
./phone-a-friend config paths                 # Show config file paths
./phone-a-friend config set <key> <value>     # Set a value (dot-notation)
./phone-a-friend config get <key>             # Get a value
./phone-a-friend config edit                  # Open in $EDITOR

# Plugin management
./phone-a-friend plugin install --claude      # Install as Claude plugin
./phone-a-friend plugin update --claude       # Update Claude plugin
./phone-a-friend plugin uninstall --claude    # Uninstall Claude plugin
```

Backward-compatible aliases: `install`, `update`, `uninstall` still work.

### Interactive TUI

```bash
./phone-a-friend                              # Launches TUI dashboard (TTY only)
```

No-args in a TTY launches a full-screen Ink (React) dashboard with 4 tabs:
- **Status** — system info + live backend detection (auto-refreshes)
- **Backends** — navigable backend list with detail pane
- **Config** — inline config editing with focus model (nav/edit modes)
- **Actions** — async-wrapped actions (re-detect, reinstall plugin, open config)

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
- CLI: `./phone-a-friend --version`
- **Auto-release**: merging to `main` with a new version automatically creates a git tag and GitHub Release
- To release: bump version in both `package.json` and `.claude-plugin/plugin.json`, merge to `main`

### When to bump

**Every PR must bump the version.** Update both `package.json` and `.claude-plugin/plugin.json` before merging.

- **Patch** (`1.0.0` → `1.0.1`): bug fixes, docs, CI changes, refactoring
- **Minor** (`1.0.0` → `1.1.0`): new features, new CLI flags, new backends
- **Major** (`1.0.0` → `2.0.0`): breaking changes to CLI contract or relay API

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

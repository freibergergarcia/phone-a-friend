# AGENTS.md

Guidance for AI coding agents working in `phone-a-friend`.

## What This Is

`phone-a-friend` is a TypeScript CLI for relaying prompts + repository context to coding backends (Claude, Codex, Gemini, Ollama). Available via `npm install -g @freibergergarcia/phone-a-friend` or from source. All backend `run()` methods are async (`Promise<string>`). Backends may also implement `runStream()` returning `AsyncIterable<string>` for token-level streaming.

## Project Structure

```
src/
  index.ts           Entry point — imports backends, runs CLI
  cli.ts             Commander.js CLI with subcommands
  relay.ts           Backend-agnostic relay core (relay + relayStream + reviewRelay)
  stream-parsers.ts  Stream parsers — SSE (OpenAI-compatible), NDJSON (Ollama), Claude JSON snapshots
  context.ts         RelayContext interface
  version.ts         Shared version reader
  detection.ts       Backend detection (CLI, Local, Host)
  config.ts          TOML configuration system
  doctor.ts          Health check command
  setup.ts           Interactive setup wizard
  installer.ts       Claude plugin installer (symlink/copy)
  theme.ts           Shared semantic theme (chalk) for CLI styling + banner
  display.ts         Display helpers (mark, formatBackendLine)
  backends/
    index.ts         Backend interface, registry, types
    claude.ts        Claude CLI subprocess backend (`claude -p`)
    codex.ts         Codex subprocess backend
    gemini.ts        Gemini subprocess backend
    ollama.ts        Ollama HTTP API backend (native fetch)
  agentic/
    index.ts         Public API — Orchestrator, TranscriptBus exports
    types.ts         AgentConfig, AgenticSessionConfig, AgentState, Message, AGENTIC_DEFAULTS
    orchestrator.ts  Main loop — spawn agents, route messages, guardrails, emit events
    session.ts       SessionManager — Claude CLI subprocess with UUID-based sessions
    bus.ts           SQLite transcript bus (better-sqlite3) — append-only session log
    queue.ts         In-memory MessageQueue for runtime routing
    events.ts        AgenticEvent discriminated union + EventChannel (push/pull bridge)
    parser.ts        @mention extraction + system prompt builder
    names.ts         Creative agent name assignment (e.g., ada.reviewer)
  web/
    index.ts         Public API — startDashboard export
    server.ts        HTTP server (node:http) with static file serving
    routes.ts        REST API — sessions, stats, SSE events, event ingestion
    sse.ts           SSE broadcaster with heartbeat and session filtering
    event-sink.ts    Batched fire-and-forget POST bridge from CLI to dashboard
    public/          Static dashboard frontend (HTML/CSS/JS)
  tui/
    App.tsx          Root TUI component — tab bar + panel routing
    render.tsx       Ink render entry point
    StatusPanel.tsx  System info + backend detection display
    BackendsPanel.tsx Per-backend list with detail pane
    ConfigPanel.tsx  Config view + inline editing
    ActionsPanel.tsx Async-wrapped executable actions
    AgenticPanel.tsx Session browser with list view and dashboard URL hint
    hooks/
      useDetection.ts    Async detection with throttled refresh
      usePluginStatus.ts Plugin install status (sync FS check)
      useAgenticSessions.ts  SQLite session loader for Agentic panel
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

- Relay core is backend-agnostic in `src/relay.ts` — `relay()` for batch, `relayStream()` for streaming, `reviewRelay()` for diff-scoped review
- Backend interface/registry in `src/backends/index.ts` — `run()` required, `runStream()` and `review()` optional
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

## Agentic Mode

Multi-agent orchestration where agents communicate via @mentions within a shared session.

### Session lifecycle

```
run(config)
  │
  ├─ 1. Init ─────── Generate session ID, reset state, create SQLite record
  │                   Assign creative names (e.g. ada.reviewer, fern.critic)
  │                   Register agents in transcript bus
  │                   Emit: session_start
  │
  ├─ 2. Spawn ────── Phase A — for each agent (sequential):
  │   (Turn 0)          Build system prompt (role, agent list, turn budget)
  │                     Spawn Claude subprocess: claude -p --session-id <uuid>
  │                     Log user→agent prompt delivery, collect response
  │                     On failure: emit error, mark agent dead
  │                   Phase B — process all collected responses:
  │                     Parse each: extract @mentions → queue, notes → transcript
  │                     Emit: message (per routed msg + notes)
  │                   Emit: turn_complete (once, after all agents)
  │
  ├─ 3. Route ────── while (turn ≤ maxTurns && !stopped):
  │   (Turn 1..N)     Check timeout → endSession('timeout')
  │                   Check empty queue → endSession('converged')
  │                   Dequeue all pending messages, grouped by recipient
  │                   For each recipient agent:
  │                     Check ping-pong detection → skip if cycling
  │                     Build prompt: "@sender says: content" (+ deadline warnings)
  │                     Resume Claude session: claude -p -r <uuid>
  │                     Parse response → route @mentions to queue, log notes
  │                     On failure: emit error, mark agent dead
  │                   Emit: turn_complete (once, after all recipients)
  │
  └─ 4. End ──────── Reason: converged | max_turns | timeout | stopped | error
                      Update SQLite status, emit session_end, close EventChannel
```

**Key behaviors:**
- Turn 0 is two-phase: spawn all agents first, then parse and route all responses together
- `@all` expands to individual messages for every other agent
- `@user` messages are logged and emitted but not routed (displayed by CLI consumers)
- Lines without `@mention` are classified as working notes — persisted but not routed
- Deadline warnings are injected at `maxTurns - 1` (warning) and `maxTurns` (final)
- Ping-pong detection uses pair-based counters with per-turn decay (halved each turn)
- Errors and guardrail triggers emit events and may mark agents dead or end the session

### Architecture

- **Orchestrator-driven**: `Orchestrator` in `src/agentic/orchestrator.ts` runs the main loop — spawns agents, routes messages, enforces guardrails, and emits events
- **Claude-only backend** currently — spawn via `claude -p --session-id <uuid>`, resume via `claude -p -r <uuid>`
- **SessionManager** (`src/agentic/session.ts`) wraps Claude CLI subprocesses with UUID-based session IDs for conversation continuity; non-Claude backends are not yet supported; stateless transcript replay infrastructure exists but is not wired up
- **In-memory MessageQueue** (`src/agentic/queue.ts`) handles runtime message routing between agents
- **SQLite TranscriptBus** (`src/agentic/bus.ts`) provides append-only persistence using better-sqlite3; DB at `~/.config/phone-a-friend/agentic.db`
- **EventChannel** (`src/agentic/events.ts`) is an `AsyncIterable` bridge that streams `AgenticEvent` discriminated unions to CLI, TUI, and web dashboard consumers
- **DashboardEventSink** (`src/web/event-sink.ts`) bridges orchestrator events to the web dashboard via batched fire-and-forget HTTP POST

### Agent naming & message routing

- Agent names get creative prefixes via `src/agentic/names.ts`: e.g., `ada.reviewer`, `fern.critic`
- Messages use `@name:` at line start for routing (parsed by `src/agentic/parser.ts`)
- Lines without `@mention` are working notes — logged to the transcript bus but not routed
- System prompt is injected per-agent with role, agent list, and turn budget (built by `buildSystemPrompt()` in `src/agentic/parser.ts`)

### Guardrails

All defaults are in `AGENTIC_DEFAULTS` (`src/agentic/types.ts`):

| Guard | Default | Description |
|-------|---------|-------------|
| `maxTurns` | 20 | Hard cap on total conversation turns |
| `timeoutSeconds` | 900 (15 min) | Session wall-clock timeout |
| `pingPongThreshold` | 6 | Detects agents bouncing messages without progress |
| `noProgressThreshold` | 2 | Stops session when no meaningful output is produced |
| `maxMessageSize` | 50 KB | Per-message size limit (not yet enforced) |
| `maxAgentTurnsPerRound` | 3 | Max turns a single agent gets before yielding (not yet enforced) |

### Web dashboard

- Default port 7777, launched via `phone-a-friend agentic dashboard`
- HTTP server in `src/web/server.ts` (node:http) with static file serving from `src/web/public/`
- REST API (`src/web/routes.ts`): `GET /api/sessions`, `GET /api/sessions/:id`, `DELETE /api/sessions/:id`, `GET /api/stats`, `POST /api/ingest`
- SSE at `GET /api/events` for live session updates (`src/web/sse.ts` — broadcaster with heartbeat and session filtering)
- Static frontend: HTML/CSS/JS in `src/web/public/` with components for session list, agent cards, message feed, and markdown rendering

## CLI Contract

After `npm install -g @freibergergarcia/phone-a-friend`, the `phone-a-friend` command is available globally. From the repo root, `./phone-a-friend` also works.

```bash
# Relay
phone-a-friend --to codex --repo <path> --prompt "..."
phone-a-friend --to claude --repo <path> --prompt "..."
phone-a-friend --to gemini --repo <path> --prompt "..." --model gemini-2.5-flash
phone-a-friend --to ollama --repo <path> --prompt "..." --model qwen3
phone-a-friend --prompt "..."               # Uses default backend from config
phone-a-friend --to claude --prompt "..." --stream     # Stream tokens as they arrive
phone-a-friend --to claude --prompt "..." --no-stream  # Disable streaming (batch mode)
phone-a-friend --to claude --prompt "..." --review     # Review mode (diff-scoped)
phone-a-friend --to codex --prompt "..." --base develop # Review against specific branch
phone-a-friend --prompt "..." --context-file notes.md  # Attach file as extra context
phone-a-friend --prompt "..." --context-text "..."     # Inline extra context
phone-a-friend --prompt "..." --include-diff           # Append git diff to prompt

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
phone-a-friend plugin install --github      # Switch to GitHub marketplace (npm source, replaces local symlink)
phone-a-friend plugin update --claude       # Update Claude plugin
phone-a-friend plugin uninstall --claude    # Uninstall Claude plugin
```

```bash
# Agentic mode
phone-a-friend agentic run --agents role:backend,... --prompt "..."
phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "Review auth" --max-turns 15
phone-a-friend agentic run --agents sec:claude --prompt "Audit" --timeout 600 --sandbox workspace-write
phone-a-friend agentic run --agents dev:claude --prompt "Build" --dashboard-url http://localhost:8080/api/ingest
phone-a-friend agentic logs
phone-a-friend agentic logs --session <id>
phone-a-friend agentic replay --session <id>
phone-a-friend agentic dashboard [--port 7777]
```

Backward-compatible aliases: `install`, `update`, `uninstall` still work.

### Interactive TUI

```bash
phone-a-friend                                # Launches TUI dashboard (TTY only)
```

No-args in a TTY launches a full-screen Ink (React) dashboard with 5 tabs:
- **Status** — system info + live backend detection (auto-refreshes)
- **Backends** — navigable backend list with detail pane
- **Config** — inline config editing with focus model (nav/edit modes)
- **Actions** — async-wrapped actions (re-detect, reinstall plugin, open config)
- **Agentic** — session browser with list view and dashboard URL hint

A persistent plugin status bar sits between the tab bar and panel content,
showing `✓ Claude Plugin: Installed` (green) or `! Claude Plugin: Not Installed` (yellow).
It updates instantly after Reinstall/Uninstall actions complete.

TTY guard: non-interactive terminals fall back to help/setup nudge.
Global keys: `q` quit, `Tab`/`1-5` switch tabs, `r` refresh detection.

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

## Marketplace distribution

Users can install the Claude Code plugin (commands and skills) via the marketplace:

    /plugin marketplace add freibergergarcia/phone-a-friend
    /plugin install phone-a-friend@phone-a-friend-marketplace

The marketplace manifest at `.claude-plugin/marketplace.json` points to the npm
package `@freibergergarcia/phone-a-friend`. Claude Code fetches and caches the
plugin from npm when users install through the marketplace.

Marketplace install provides Claude Code integration only (slash commands and skills).
For the full CLI (agentic mode, TUI dashboard, web dashboard on localhost), users
still need `npm install -g @freibergergarcia/phone-a-friend`.

## Scope

This repository contains relay functionality, backend detection, configuration system, Claude plugin installer, interactive TUI dashboard, agentic multi-agent orchestration, and web dashboard for session visibility. Policy engines, hooks, approvals, and trusted scripts are intentionally out of scope.

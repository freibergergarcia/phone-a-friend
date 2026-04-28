# AGENTS.md

Guidance for AI coding agents working in `phone-a-friend`.

## What This Is

`phone-a-friend` is a TypeScript CLI for relaying prompts + repository context to coding backends (Claude, Codex, Gemini, Ollama, OpenCode). Available via `npm install -g @freibergergarcia/phone-a-friend` or from source. All backend `run()` methods are async (`Promise<string>`). Backends may also implement `runStream()` returning `AsyncIterable<string>` for token-level streaming.

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
  installer.ts       Claude/OpenCode host integration installer (symlink/copy)
  theme.ts           Shared semantic theme (chalk) for CLI styling + banner
  display.ts         Display helpers (mark, formatBackendLine)
  jobs.ts            Background job manager (JSON persistence at ~/.config/phone-a-friend/jobs.json)
  sessions.ts        Relay session store (JSON persistence at ~/.config/phone-a-friend/sessions.json)
  backends/
    index.ts         Backend interface, registry, types, BackendCapabilities, spawnCli() async subprocess utility
    claude.ts        Claude CLI subprocess backend (`claude -p`)
    codex.ts         Codex subprocess backend
    gemini.ts        Gemini subprocess backend
    ollama.ts        Ollama HTTP API backend (native fetch)
    opencode.ts      OpenCode CLI subprocess backend (`opencode run`, agentic with tool calling)
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
      usePluginStatus.ts Host integration install status (sync FS check)
      useAgenticSessions.ts  SQLite session loader for Agentic panel
    components/
      TabBar.tsx             Tab navigation bar
      PluginStatusBar.tsx    Persistent host integration install indicator
      Badge.tsx              Status badges (✓ ✗ ! ·)
      KeyHint.tsx            Footer keyboard hints
      ListSelect.tsx         Scrollable selectable list
tests/               Vitest tests (mirrors src/ structure, includes spawn-cli, jobs, background-relay)
skills/              Canonical Agent Skills (`skills/<name>/SKILL.md`) shared by Claude Code and OpenCode
commands/            Thin slash-command shims that delegate into the canonical skills
dist/                Built bundle (committed, self-contained)
```

## Core Behavior

- Relay core is backend-agnostic in `src/relay.ts` — `relay()` for batch, `relayStream()` for streaming, `reviewRelay()` for diff-scoped review, `relayBackground()` for quiet mode with job tracking
- Backend interface/registry in `src/backends/index.ts` — `run()` required, `runStream()` and `review()` optional, `capabilities` declares resume strategy and session ID requirements
- Shared `spawnCli()` async subprocess utility in `src/backends/index.ts` — used by all CLI backends (Codex, Claude, Gemini, OpenCode) for non-blocking execution with timeout, signal forwarding, stderr draining, and spawn error handling. Throws `SpawnCliError` (extends `BackendError`) on non-zero exit, preserving stdout/stderr/exitCode for callers that need partial output from failed runs
- `BackendRunOptions` shared interface in `src/backends/index.ts` — single options type for `run()` and `runStream()` across all backends, includes schema, session, and fast spawn fields
- Backend `localFileAccess: boolean` property — controls whether repo path is passed or file contents are inlined
- Claude backend in `src/backends/claude.ts` (`run()` via `spawnCli()`, `runStream()` via direct `spawn` with streaming parser)
- Codex backend in `src/backends/codex.ts` (via `spawnCli()`, output file + stdout fallback)
- Gemini backend in `src/backends/gemini.ts` (via `spawnCli()`)
- Ollama HTTP backend in `src/backends/ollama.ts` (fetch to localhost:11434, already async)
- OpenCode CLI backend in `src/backends/opencode.ts` (`run()` and `runStream()` via subprocess, `review()` with native repo access via `--dir`, model normalization `qwen3-coder` to `ollama/qwen3-coder`, NDJSON output parsing, session support via `--session`)
- Stream parsers in `src/stream-parsers.ts` — SSE (OpenAI-compatible), NDJSON (Ollama), Claude JSON snapshots, OpenCode NDJSON events
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
- **SessionManager** (`src/agentic/session.ts`) wraps CLI subprocesses with UUID-based session IDs for conversation continuity; routes via `BackendCapabilities.resumeStrategy` (`native-session` for Claude, `transcript-replay` fallback for others)
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
phone-a-friend --to opencode --repo <path> --prompt "..." --model qwen3-coder  # Local agentic (OpenCode + Ollama)
phone-a-friend --prompt "..."               # Uses default backend from config
phone-a-friend --to claude --prompt "..." --stream     # Stream tokens as they arrive
phone-a-friend --to claude --prompt "..." --no-stream  # Disable streaming (batch mode)
phone-a-friend --to claude --prompt "..." --review     # Review mode (diff-scoped)
phone-a-friend --to codex --review                     # Review mode (--prompt optional, defaults to generic review)
phone-a-friend --to opencode --review                  # Review with local model (reads repo via tools)
phone-a-friend --to codex --prompt "..." --base develop # Review against specific branch
phone-a-friend --prompt "..." --context-file notes.md  # Attach file as extra context
phone-a-friend --prompt "..." --context-text "..."     # Inline extra context
phone-a-friend --prompt "..." --include-diff           # Append git diff to prompt
phone-a-friend --to codex --prompt "..." --quiet       # Run silently, save result to job store
phone-a-friend --to claude --prompt "..." --schema '{"type":"object"}'  # Structured JSON output
phone-a-friend --to codex --prompt "..." --session my-review           # Start or resume a PaF-managed session
phone-a-friend --to codex --prompt "..." --backend-session 019dd45f-... # Attach to a raw backend thread (no PaF persistence)
phone-a-friend --to codex --prompt "..." --session adopt --backend-session 019dd45f-...  # Adopt a backend thread under a PaF label
phone-a-friend --to claude --prompt "..." --fast                       # Fast mode (--bare for Claude, --pure for OpenCode)

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
phone-a-friend plugin install --opencode    # Install OpenCode commands and skills
phone-a-friend plugin install --all         # Install all host integrations
phone-a-friend plugin install --github      # Switch to GitHub marketplace (npm source, replaces local symlink)
phone-a-friend plugin update --claude       # Update Claude plugin
phone-a-friend plugin update --opencode     # Update OpenCode commands and skills
phone-a-friend plugin uninstall --claude    # Uninstall Claude plugin
phone-a-friend plugin uninstall --opencode  # Uninstall OpenCode commands and skills

# Job management
phone-a-friend job status                  # List all tracked jobs
phone-a-friend job status --json           # List as JSON
phone-a-friend job result <id>             # Show output of a completed job
phone-a-friend job cancel <id>             # Mark a running/pending job as cancelled
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
- **Actions** — async-wrapped actions (re-detect, reinstall host integrations, open config)
- **Agentic** — session browser with list view and dashboard URL hint

A persistent plugin status bar sits between the tab bar and panel content,
showing Claude and OpenCode host integration state. It updates instantly after
install/uninstall actions complete.

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

OpenCode has no marketplace. `phone-a-friend plugin install --opencode` copies or
symlinks the canonical `skills/<name>/SKILL.md` directories plus `commands/*.md`
shims into `~/.config/opencode/skills/` and `~/.config/opencode/commands/`
respectively, honoring `$XDG_CONFIG_HOME`.

## Job tracking

The `--quiet` flag runs a relay without interactive output and persists the result to a job store.

- `JobManager` in `src/jobs.ts` reads/writes `~/.config/phone-a-friend/jobs.json`
- `relayBackground()` in `src/relay.ts` wraps `relay()` with job lifecycle (pending, running, completed/failed)
- Jobs are capped at 50, oldest completed/failed/cancelled are pruned on create
- `--quiet` keeps the process alive until the job finishes (not truly detached). For detached execution, users can combine with `nohup` or `&`.
- `job cancel` marks the job as cancelled in the store but cannot kill the subprocess (PID tracking is not yet implemented)

## Structured output

The `--schema` flag requests JSON output matching a JSON Schema from backends that support it.

- Claude: native enforcement via `--output-format json --json-schema`
- Codex: native enforcement via `--output-schema <tempfile> --json` (schema written to temp file)
- Gemini: `--output-format json` with schema injected into prompt (best-effort, not validated)
- Ollama: `format: "json"` in HTTP body with schema injected into prompt (best-effort)
- Streaming is disabled when `--schema` is active (structured output requires batch mode)

## Session continuity

Two flags handle session resume, with separate concerns:

- `--session <label>` is a PaF-managed label. PaF stores the label and the underlying backend session ID together in `~/.config/phone-a-friend/sessions.json` and uses the label for lookup on subsequent calls.
- `--backend-session <id>` is a raw passthrough. PaF skips the label store and resumes the backend session directly. Combine with `--session <label>` to also start tracking that backend session under a label (adoption). Adoption is idempotent: re-running the same `--session label --backend-session id` pair is fine; conflicts (same label pointing at a different backend, session id, or repo) error explicitly.

Implementation notes:

- `SessionStore` in `src/sessions.ts` reads/writes `~/.config/phone-a-friend/sessions.json`
- Sessions are capped at 100, oldest by last-used are pruned on overflow
- Claude: `--session-id` on start, `-r` on resume. UUID generated client-side.
- Codex: thread ID captured from `thread.started` JSONL event, `codex exec resume <thread-id>`
- Ollama: stateless replay (full history prepended to each request)
- `--backend-session` is only valid for backends with `resumeStrategy: 'native-session'` (Codex, Claude, OpenCode)
- `--session` errors out for backends with `resumeStrategy: 'unsupported'` (currently Gemini) instead of silently fresh-spawning each call
- An unknown `--session <label>` no longer silently fresh-spawns; PaF prints a stderr warning before starting a new session under that label
- Streaming is disabled when `--session` or `--backend-session` is active

### History persistence rule

PaF only persists conversation `history` for backends whose resume mechanism actually replays it (`resumeStrategy === 'transcript-replay'` — currently only Ollama). For everything else (`native-session`, `unsupported`), the row stores metadata + `backendSessionId` and `history: []`. Existing rows that were created before this rule have their fat history trimmed on the next write to that label.

Why: Codex/Claude/OpenCode resume from their own server-side state. Storing the full expanded prompts + replies on PaF's side is dead weight that bloats `sessions.json` without affecting resume behavior. For Ollama, history *is* the resume mechanism (replay), so it's kept intact.

### Atomicity, corruption, concurrency

- **Atomic writes:** `sessions.json` is written via temp file + `fsync` + rename + parent-dir `fsync`. A crash mid-write cannot produce torn JSON.
- **Loud corruption recovery:** if the file fails to parse on load, PaF rotates it to `sessions.json.corrupt-<timestamp>`, logs the path to stderr, and starts with an empty store for the current process. The previous behavior silently dropped every session, which made partial writes catastrophic.
- **Not parallel-write safe:** two PaF processes writing concurrently can lose updates (last-writer-wins on rename). Single-process use only. SQLite migration is the proper fix when concurrency materializes.

### Session management commands

```bash
phone-a-friend session list                    # show all persisted sessions
phone-a-friend session list --json             # machine-readable
phone-a-friend session delete <label>          # remove a single label
phone-a-friend session prune --older-than 30   # drop sessions older than N days (default 30)
phone-a-friend session prune --all             # drop everything
```

### Known limitations

- **Codex resume + schema**: `codex exec resume` does not accept `--output-schema`. Schema is enforced on turn 1 only; subsequent turns rely on model conversation context to maintain the format, with no server-side validation.
- **Gemini sessions**: declared `unsupported`. The Gemini CLI session surface (session ID extraction, `--resume` semantics) was never verified against live output, and `run()` doesn't use `sessionHistory`. `--session` against Gemini errors loudly until the surface is confirmed.
- **Codex review + custom prompt**: `codex exec review` does not accept both `--base` and a positional prompt. When a custom prompt is provided with `--review`, the relay skips native `review()` and uses the generic `run()` path with the diff inlined.
- **Streaming + sessions**: `relayStream()` forwards session options to backends but does not implement session lifecycle (validation, history persistence). The CLI gates this combination off; only programmatic callers are affected.

## Fast spawn

The `--fast` flag maps to `--bare` for the Claude backend, skipping project context loading (CLAUDE.md, MCP servers, skills, hooks), and to `--pure` for the OpenCode backend, skipping external plugins. No-op for other backends. Useful for self-contained tasks where project conventions and tools are not needed.

## Scope

This repository contains relay functionality, backend detection, configuration system, Claude/OpenCode host integration installers, interactive TUI dashboard, agentic multi-agent orchestration, web dashboard for session visibility, background job tracking, structured output, session continuity, and fast spawn. Policy engines, hooks, approvals, and trusted scripts are intentionally out of scope.

# Unified Plan: Evolve phone-a-friend into a Standalone CLI

**Date**: 2026-02-22
**Updated**: 2026-02-22
**Status**: Step 1 complete, Step 2 complete — ready for Step 3
**Starting version**: 0.4.3
**Current version**: 1.1.0-alpha.1
**Language**: TypeScript (rewrite from Python — see Round 10)

---

## Context

phone-a-friend started as a Python CLI / Claude plugin that shells out to CLI tools (codex, gemini). This plan rewrites the tool in TypeScript and adds direct HTTP API backends (Ollama, OpenAI, Google, Anthropic), a configuration system, native npm distribution, and Ollama tool-calling — transforming the project from a Claude-specific plugin into a standalone CLI tool.

### Why TypeScript

> **Round 10 decision (Codex recommended, user approved)**: The project distributes via npm. The #1 UX priority is a polished installer and setup wizard. An npm package that requires Python >= 3.10 on the user's machine is a fundamental DX contradiction. The codebase is ~890 lines of subprocess calls and HTTP POSTs — straightforward to port. TypeScript gives us native npm distribution, Inquirer.js/chalk/ora for interactive CLI, and eliminates the dual Typer/argparse maintenance burden.

### Priority: CLI experience first

The CLI experience IS the product. The first thing we build is getting the developer experience right — setup wizard, health checks, backend detection, configuration, installer. Backends plug into this foundation. The interfaces for ALL backends (including unimplemented ones) are designed from day one so the UX is cohesive, not bolted on.

### Goals (ordered by priority)

1. **TypeScript port** — port existing relay logic, same CLI contract, native npm package
2. **CLI UX foundation** — setup wizard, doctor, three-category backend detection, configuration system
3. **Ollama backend** — first HTTP API backend, local inference
4. **API-key backends** — OpenAI, Google, Anthropic (interfaces ready from step 2, implementation later)
5. **Ollama tool-calling** — multi-turn agent loop with read-only and mutating tools
6. **Backward compatibility** — same CLI flags, same behavior as Python version

---

## Tech stack

| Concern | Choice | Why |
|---------|--------|-----|
| Language | TypeScript | Native npm, rich CLI ecosystem |
| Runtime | Node.js >= 18 | LTS, native `fetch`, stable `child_process` |
| CLI framework | [Commander.js](https://github.com/tj/commander.js) | Lightweight, one framework instead of Typer+argparse |
| Interactive prompts | [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) | Arrow-key selection, confirmations, input prompts |
| Terminal styling | [chalk](https://github.com/chalk/chalk) | Colored output, checkmarks, styled status |
| Spinners | [ora](https://github.com/sindresorhus/ora) | Loading indicators for backend detection, test runs |
| Config format | TOML | Human-readable, supports comments, familiar to devs |
| TOML parser | [smol-toml](https://github.com/nicolo-ribaudo/smol-toml) | Tiny, zero-dep, read + write |
| HTTP client | Native `fetch` | Built into Node 18+, no deps needed |
| Subprocess | `child_process.execFile` | For codex/gemini CLI backends |
| Testing | [vitest](https://vitest.dev/) | Fast, native TS support |
| Build | [tsup](https://github.com/egoist/tsup) | Bundle to single JS file for npm bin |

---

## Backend naming convention

Each backend gets a unique name tied to its transport. No aliases, no modes.

| Name | Transport | What it does |
|------|-----------|-------------|
| `codex` | subprocess | Existing: `codex exec` CLI |
| `gemini` | subprocess | Existing: `gemini` CLI |
| `ollama` | HTTP | Local Ollama API (`http://localhost:11434`) |
| `openai` | HTTP | OpenAI chat completions API |
| `google` | HTTP | Google AI Gemini REST API |
| `anthropic` | HTTP | Anthropic Messages API |

> **Decision**: Separate names, not modes. `gemini` and `google` are distinct — one is Google's CLI tool with its own agent/tool runtime, the other is a direct API call for pure inference.

---

## CLI UX Design

> **This section defines the product experience.** Everything else serves this.

### Command tree

```
phone-a-friend                          # Smart: setup nudge if first run, help otherwise
phone-a-friend setup                    # Interactive setup wizard (the key moment)
phone-a-friend doctor                   # Health check all backends (human-friendly)
phone-a-friend doctor --json            # Health check (machine-readable, exit codes)
phone-a-friend config init              # Create default config (non-interactive)
phone-a-friend config show              # Show resolved config (merged sources)
phone-a-friend config show --sources    # Show which file each value comes from
phone-a-friend config paths             # Print all config file paths (user + repo)
phone-a-friend config edit              # Open user config in $EDITOR
phone-a-friend config set <key> <val>   # Set config value (dot-notation, typed)
phone-a-friend config get <key>         # Get config value
phone-a-friend plugin install --claude  # Install as Claude Code plugin
phone-a-friend plugin update --claude   # Update Claude plugin
phone-a-friend plugin uninstall --claude  # Uninstall Claude plugin
phone-a-friend --to <backend> --prompt "..." [flags]  # Relay (the core)
phone-a-friend --prompt "..."           # Relay using configured default backend
phone-a-friend --version                # Version
phone-a-friend --help                   # Help
```

### The 6 UX moments

#### Moment 1 — Install

```
npm install -g phone-a-friend
```

One command. No Python required. After install, the user types `phone-a-friend` for the first time.

#### Moment 2 — First run (no args, no config)

```
$ phone-a-friend

  phone-a-friend v1.0.0 — AI coding agent relay

  No backends configured yet. Run setup to get started:

    phone-a-friend setup

  Or jump straight in (requires codex in PATH):

    phone-a-friend --to codex --prompt "What does this project do?"
```

When config exists, `phone-a-friend` (no args) shows `--help` as usual.

#### Moment 3 — Setup wizard (`phone-a-friend setup`)

The most important moment. Interactive, auto-detects everything, opinionated.

```
$ phone-a-friend setup

  phone-a-friend v1.0.0 — Setup

  Scanning your environment...

  Relay Backends:
    CLI:
      ✓ codex     OpenAI Codex CLI (found in PATH)
      ✓ gemini    Google Gemini CLI (found in PATH)
    Local:
      ✓ ollama    http://localhost:11434
                  Models: qwen3:latest, llama3.2:latest, codellama:latest
    API:
      ✗ openai    OPENAI_API_KEY not set
      ✗ anthropic ANTHROPIC_API_KEY not set  [planned]
      ✗ google    GOOGLE_API_KEY not set     [planned]

  Host Integrations:
      ✗ claude    Claude Code CLI — npm install -g @anthropic-ai/claude-code

  ? Default backend: (arrow keys to select)
  ❯ codex (installed)
    ollama (running, 3 models)
    gemini (installed)
    openai (needs API key)

  > codex

  ? Configure API keys? (y/N) y

  ? OPENAI_API_KEY env var name [OPENAI_API_KEY]: ↵
  ✓ Found OPENAI_API_KEY in environment

  ? Install as Claude Code plugin? (Y/n) y
  ✓ Plugin installed at ~/.claude/plugins/phone-a-friend
  ✓ Plugin enabled in Claude Code

  ✓ Config saved to ~/.config/phone-a-friend/config.toml

  ? Run a quick test? (Y/n) y
  ✓ codex responded in 2.3s

  You're ready! Try:
    phone-a-friend --prompt "What does this project do?"

  Tip: alias paf='phone-a-friend'
```

**Design rules for setup:**
- Auto-detects ALL backends before asking ANY questions
- **Relay Backends vs Host Integrations**: `claude` is NOT a `--to` relay target — it's a host integration (the plugin system). Shown separately to avoid confusion.
- Never stores actual API keys — stores env var names, checks if vars are set
- Ollama detection: HTTP ping to `localhost:11434/api/tags` to list models
- CLI detection: `which` for codex/gemini/claude
- Claude plugin install offered only if `claude` binary is in PATH
- Re-runnable — `phone-a-friend setup` can always be run again
- **Auto-select**: if only one backend is available, auto-select it with confirmation instead of showing a list
- **Unimplemented backends**: shown as `[planned]` in scan, not selectable as default until backend code lands
- **Post-setup test**: offers to send a quick ping to the selected default backend, converting "configured" into "verified"
- **Alias suggestion**: shown after successful setup for power users

#### Moment 4 — Doctor (`phone-a-friend doctor`)

Read-only health check. Run when something's broken.

```
$ phone-a-friend doctor

  phone-a-friend v1.0.0 — Health Check

  System:
    ✓ Node.js 20.11.0
    ✓ Config ~/.config/phone-a-friend/config.toml

  Relay Backends:
    CLI:
      ✓ codex     /opt/homebrew/bin/codex
      ✓ gemini    /opt/homebrew/bin/gemini
    Local:
      ✓ ollama    http://localhost:11434 (responding)
                  Models: qwen3:latest, llama3.2:latest
    API:
      ✓ openai    OPENAI_API_KEY ✓ (set)
      ✗ anthropic ANTHROPIC_API_KEY not set
      ✗ google    GOOGLE_API_KEY not set

  Host Integrations:
    ✗ claude    not in PATH
               npm install -g @anthropic-ai/claude-code

  Claude Plugin:
    ✓ Installed ~/.claude/plugins/phone-a-friend
    ✓ Enabled

  Default: codex ✓

  4 of 6 relay backends ready
```

**Doctor design rules:**
- Read-only — never changes anything, just reports
- **`--json` flag**: outputs structured JSON for agents, CI, and bug reports
- **Exit codes**: `0` = all relay backends healthy, `1` = some backends have issues, `2` = config error or no backends available
- **Relay vs Host**: uses same separation as setup — relay backend count excludes `claude` (which is a host integration, not a `--to` target)

#### Moment 5 — Configuration

```bash
phone-a-friend config show             # Pretty-print resolved config
phone-a-friend config show --sources   # Show which file each value comes from
phone-a-friend config paths            # Print all config file paths (user + repo)
phone-a-friend config edit             # Open user config in $EDITOR
phone-a-friend config set <k> <v>      # Dot-notation: defaults.backend, backends.ollama.host
phone-a-friend config get <k>          # Read a value
phone-a-friend config init             # Create default config file (non-interactive)
```

`config init` creates a sane default file silently. `setup` is the interactive version. Both produce a config file, but `setup` is what you recommend to humans.

**`config set` typing rules:**
- Booleans: `true`/`false` (case-insensitive) → TOML bool
- Integers: bare digits → TOML int (e.g., `timeout 300`)
- Everything else → TOML string
- Validation: known keys are checked against expected types. Unknown keys are allowed (forward-compat) but emit a warning.

#### Moment 6 — Daily use (relay)

The relay stays flag-driven — mostly consumed by Claude/agents, not typed by hand:

```bash
# Explicit backend
phone-a-friend --to codex --repo . --prompt "Review this code"
phone-a-friend --to ollama --prompt "Explain this" --context-file ./src/main.py

# Uses configured default backend (set via setup or config)
phone-a-friend --prompt "What does this project do?"
```

### Backend detection — three categories

Every backend type has a completely different detection method. This is a core design decision.

#### Relay backends (selectable via `--to`)

| Category | Backends | Detection | What "available" means | When checked |
|----------|----------|-----------|----------------------|-------------|
| **CLI** | codex, gemini | `which` (PATH check) | Binary in PATH | setup, doctor |
| **Local service** | ollama | `fetch` GET `/api/tags` + `which ollama` | Server responds + model list | setup, doctor |
| **API key** | openai, anthropic, google | `process.env[var]` | Env var is set (not validated) | setup, doctor |

#### Host integrations (NOT relay targets)

| Name | Detection | Purpose |
|------|-----------|---------|
| claude | `which claude` | Claude Code plugin system — `phone-a-friend plugin install --claude` |

> **Why the split**: `claude` is the host that RUNS phone-a-friend as a plugin. It is not a backend you relay prompts TO. Mixing it into "backends" creates a count mismatch (users see "7 backends" but only 6 are `--to` targets). Setup and doctor show these in separate sections.

**Important**: We NEVER validate API keys at setup/doctor time. Just check presence. Validation happens at relay time. This keeps setup fast and avoids burning API credits.

For Ollama: `doctor`/`setup` do a live HTTP ping. But `which ollama` for binary presence is also useful context ("installed but not running" vs "not installed at all").

### Install hints (actionable error messages)

When something isn't available, always show how to fix it:

**Relay backends:**

| Backend | Category | Install hint |
|---------|----------|-------------|
| codex | CLI | `npm install -g @openai/codex` |
| gemini | CLI | `npm install -g @google/gemini-cli` |
| ollama | local | `brew install ollama` / `curl -fsSL https://ollama.com/install.sh \| sh` |
| openai | API | `export OPENAI_API_KEY=sk-...` |
| anthropic | API | `export ANTHROPIC_API_KEY=sk-ant-...` |
| google | API | `export GOOGLE_API_KEY=...` |

**Host integrations:**

| Name | Install hint |
|------|-------------|
| claude | `npm install -g @anthropic-ai/claude-code` |

---

## Environment variable contract

Precedence: **CLI flags > env vars > repo config > user config > defaults**.

| Option | CLI flag | Env var | Config key | Default |
|--------|----------|---------|------------|---------|
| Backend | `--to` | `PHONE_A_FRIEND_BACKEND` | `defaults.backend` | `codex` |
| Sandbox | `--sandbox` | `PHONE_A_FRIEND_SANDBOX` | `defaults.sandbox` | `read-only` |
| Timeout | `--timeout` | `PHONE_A_FRIEND_TIMEOUT` | `defaults.timeout` | `600` |
| Model | `--model` | *(per-backend, see below)* | `backends.<name>.model` | *(per-backend)* |
| Include diff | `--include-diff` | `PHONE_A_FRIEND_INCLUDE_DIFF` | `defaults.include_diff` | `false` |

### Per-backend model env vars

| Backend | Env var | Default model |
|---------|---------|---------------|
| `codex` | *(none — codex CLI handles it)* | — |
| `gemini` | *(none — gemini CLI handles it)* | — |
| `ollama` | `OLLAMA_MODEL` | *(server default)* |
| `openai` | `OPENAI_MODEL` | `gpt-4o` |
| `google` | `GOOGLE_MODEL` | `gemini-2.5-pro` |
| `anthropic` | `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` |

### API key resolution

API keys are **never stored in config files**. Config stores the **env var name** to read from.

Resolution order: `--api-key-env` CLI flag > `backends.<name>.api_key_env` config > hardcoded default env var name.

| Backend | Default env var | Config override |
|---------|----------------|-----------------|
| `openai` | `OPENAI_API_KEY` | `backends.openai.api_key_env = "MY_CUSTOM_KEY"` |
| `google` | `GOOGLE_API_KEY` | `backends.google.api_key_env = "..."` |
| `anthropic` | `ANTHROPIC_API_KEY` | `backends.anthropic.api_key_env = "..."` |

### How API keys flow through relay — `RelayContext`

```typescript
// src/context.ts
interface RelayContext {
  backend: string;
  model: string | null;
  sandbox: string;
  timeout: number;
  repoPath: string;
  includeDiff: boolean;
  env: Record<string, string>;  // resolved API keys + extra env vars
}
```

**Flow:**
1. **CLI layer** builds `RelayContext` from merged config + env vars + CLI flags. Resolves API key env var names, reads actual values, places them in `env`. No `process.env` mutation.
2. **`relay()`** receives the full context. Passes `env` to backends.
3. **Backends** read `env.OPENAI_API_KEY` etc. from the context env — clean, explicit.

---

## Backend detection — `src/detection.ts`

Three-category detection system used by `setup`, `doctor`, and the relay itself.

```typescript
// src/detection.ts

interface BackendStatus {
  name: string;               // "codex", "ollama", "openai", etc.
  category: "cli" | "local" | "api";
  available: boolean;
  detail: string;             // "/opt/homebrew/bin/codex", "3 models", "OPENAI_API_KEY set"
  installHint: string;        // "npm install -g @openai/codex", "export OPENAI_API_KEY=..."
  models?: string[];          // For Ollama: list of pulled models
}

interface DetectionReport {
  cli: BackendStatus[];
  local: BackendStatus[];
  api: BackendStatus[];
  host: BackendStatus[];      // claude (not a relay target)
}

function detectCliBackends(): Promise<BackendStatus[]>;   // which codex/gemini
function detectLocalBackends(): Promise<BackendStatus[]>; // fetch /api/tags
function detectApiBackends(): BackendStatus[];            // process.env check
function detectHostIntegrations(): Promise<BackendStatus[]>; // which claude
function detectAll(): Promise<DetectionReport>;
```

### Ollama detection — dual check

Ollama gets both checks:
1. `which ollama` — is the binary installed?
2. `fetch("http://localhost:11434/api/tags")` — is the server running?

Four states in doctor output:
- `✓ ollama` (installed + running + models)
- `! ollama` (installed + running, no models → `ollama pull qwen3`)
- `! ollama` (installed, not running → `ollama serve`)
- `✗ ollama` (not installed → install hint)

---

## Step 1: TypeScript port + npm package (PR — 0.4.3 → 1.0.0-alpha.1) — COMPLETE

> **Why port first**: Establishes the TS project, proves CLI contract parity with Python version. Everything new is built in TS from this point forward.

### Project structure (current)

```
phone-a-friend/
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # Commander.js CLI
│   ├── relay.ts              # Core relay logic
│   ├── context.ts            # RelayContext interface
│   ├── version.ts            # Shared version reader
│   ├── detection.ts          # Three-category backend detection
│   ├── config.ts             # TOML configuration system
│   ├── setup.ts              # Interactive setup wizard
│   ├── doctor.ts             # Health check (human + --json)
│   ├── installer.ts          # Claude plugin install/uninstall + registry sync
│   ├── backends/
│   │   ├── index.ts          # Backend registry + types
│   │   ├── codex.ts          # Codex subprocess backend
│   │   └── gemini.ts         # Gemini subprocess backend
│   └── tui/                  # Interactive TUI dashboard (Ink/React)
│       ├── App.tsx
│       ├── StatusPanel.tsx
│       ├── BackendsPanel.tsx
│       ├── ConfigPanel.tsx
│       ├── ActionsPanel.tsx
│       ├── hooks/useDetection.ts
│       └── components/ (TabBar, KeyHint, ListSelect)
├── tests/                    # 16 test files, 228 tests
├── dist/                     # Built output (self-contained)
├── .claude-plugin/
│   └── plugin.json
├── commands/                 # Claude plugin commands
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── plans/
```

### Port mapping

| Python file | → TS file | Notes |
|-------------|-----------|-------|
| `relay.py` (~80 lines) | `src/relay.ts` | `subprocess.run` → `execFile`, env dict stays |
| `backends/codex.py` (~60) | `src/backends/codex.ts` | `execFile("codex", [...])` |
| `backends/gemini.py` (~60) | `src/backends/gemini.ts` | `execFile("gemini", [...])` |
| `backends/__init__.py` (~60) | `src/backends/index.ts` | Registry, `which` for PATH check |
| `cli.py` (~430) | `src/cli.ts` | Commander.js — one framework, not two |
| `installer.py` (~200) | `src/installer.ts` | `fs.symlink`, `execFile("claude", [...])` |

### package.json

```json
{
  "name": "phone-a-friend",
  "version": "1.0.0-alpha.1",
  "description": "CLI relay that lets AI coding agents collaborate",
  "type": "module",
  "bin": { "phone-a-friend": "dist/index.js" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "dev": "tsup src/index.ts --format esm --watch"
  },
  "files": ["dist/", ".claude-plugin/", "commands/", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "license": "MIT",
  "dependencies": {
    "commander": "^12.0.0"
  }
}
```

> Note: Inquirer.js, chalk, ora added in Step 2 when setup/doctor are built. Step 1 is a minimal port — CLI + relay + backends only.

### Acceptance criteria

- [x] `npm install -g phone-a-friend && phone-a-friend --version` works
- [x] `phone-a-friend --to codex --repo . --prompt "Hello"` produces same output as Python version
- [x] `phone-a-friend --to gemini --repo . --prompt "Hello"` produces same output as Python version
- [x] `phone-a-friend plugin install --claude` installs the Claude plugin
- [x] `phone-a-friend plugin update --claude` updates
- [x] `phone-a-friend plugin uninstall --claude` removes
- [x] All existing CLI flags work: `--to`, `--repo`, `--prompt`, `--context-file`, `--context-text`, `--include-diff`, `--timeout`, `--model`, `--sandbox`
- [x] Depth guard (`PHONE_A_FRIEND_DEPTH`) works
- [x] `vitest run` passes with ported tests
- [x] Python source removed (cleanup done early — TS version verified stable)

### Versioning: 2-file sync (simplified)

| File | Role |
|------|------|
| `package.json` | **SSOT** — version, npm registry |
| `.claude-plugin/plugin.json` | Claude plugin system |

> `pyproject.toml` is kept for the Python reference code but is no longer the source of truth.

---

## Step 2: CLI UX Foundation — setup, doctor, detection, config (PR → 1.0.0-alpha.2) — COMPLETE

> **Why CLI UX second**: With the TS port done, we now have access to Inquirer.js, chalk, and ora. This step builds the polished interactive experience that was the original priority.
>
> **What was actually built**: setup wizard, doctor (human + JSON), three-category detection, TOML config system, branded CLI UX (banner, rich errors, spinners), **interactive TUI dashboard** (Ink/React — Status, Backends, Config, Actions tabs), and plugin uninstall with registry cleanup. Multiple Codex review rounds hardened the implementation (fetch signal wiring, broken symlink handling, input locking, $EDITOR splitting, etc.).

### New files

```
src/
├── detection.ts          # Three-category backend detection
├── setup.ts              # Interactive setup wizard (Inquirer.js)
├── doctor.ts             # Health check (chalk output + --json)
├── config.ts             # Config loading, merging, TOML read/write
├── version.ts            # Shared version reader (package.json)
├── tui/                  # Interactive TUI dashboard (Ink/React)
│   ├── App.tsx           # Root — tab bar + panel routing + keyboard hints
│   ├── StatusPanel.tsx   # System info + detection summary
│   ├── BackendsPanel.tsx # Backend list with detail view
│   ├── ConfigPanel.tsx   # Inline config editing with focus gating
│   ├── ActionsPanel.tsx  # Actions with confirmation + auto-exit
│   ├── hooks/
│   │   └── useDetection.ts  # Shared detection state hook
│   └── components/
│       ├── TabBar.tsx    # Tab navigation bar
│       ├── KeyHint.tsx   # Keyboard shortcut hints
│       └── ListSelect.tsx # Scrollable list selector
tests/
├── detection.test.ts
├── config.test.ts
├── tui/
│   ├── smoke.test.tsx
│   ├── App.test.tsx
│   ├── StatusPanel.test.tsx
│   ├── BackendsPanel.test.tsx
│   ├── ConfigPanel.test.tsx
│   └── ActionsPanel.test.tsx
```

### New dependencies

```json
{
  "inquirer": "^9.0.0",
  "chalk": "^5.0.0",
  "ora": "^8.0.0",
  "smol-toml": "^1.0.0"
}
```

### Modified files

- `src/cli.ts` — Add `setup`, `doctor`, `config`, `plugin` subcommands. Smart no-args behavior. Default backend from config.
- `src/backends/index.ts` — Export types for detection

### Config schema

```toml
[defaults]
backend = "codex"
sandbox = "read-only"
timeout = 600
include_diff = false

[backends.codex]
model = "o3"

[backends.openai]
api_key_env = "OPENAI_API_KEY"
model = "gpt-4o"

[backends.ollama]
host = "http://localhost:11434"
model = "qwen3"

[backends.google]
api_key_env = "GOOGLE_API_KEY"
model = "gemini-2.5-pro"

[backends.anthropic]
api_key_env = "ANTHROPIC_API_KEY"
model = "claude-sonnet-4-20250514"
```

### Acceptance criteria

- [x] `phone-a-friend setup` runs interactive wizard with Inquirer.js prompts
- [x] Setup separates "Relay Backends" from "Host Integrations" in output
- [x] Setup auto-selects default if only one backend available
- [x] Setup offers post-setup test run against selected backend (ora spinner)
- [x] Setup marks unimplemented backends as `[planned]`
- [x] Setup suggests shell alias after success
- [x] `phone-a-friend doctor` shows full health check with chalk-styled output
- [x] `phone-a-friend doctor --json` outputs structured JSON
- [x] Doctor exit codes: `0` healthy, `1` issues, `2` config error
- [x] `phone-a-friend` (no args, no config) shows setup nudge with tagline
- [x] `phone-a-friend` (no args, with config) shows help
- [x] `phone-a-friend --prompt "..."` uses configured default backend
- [x] CLI detection: finds codex/gemini via `which` (relay), claude separately (host)
- [x] Ollama detection: binary check + HTTP ping to `/api/tags`, four states
- [x] API detection: checks env var presence without validation
- [x] Install hints shown for every missing backend/integration
- [x] `config init` creates valid TOML at XDG path
- [x] `config show` displays resolved config
- [x] `config paths` shows both user and repo config paths
- [x] `config edit` opens config in `$EDITOR`
- [x] `config set` validates types (bool/int/string)
- [x] `config set/get` round-trips
- [x] Interactive TUI dashboard with 4 tabs (Status, Backends, Config, Actions)
- [x] TUI: inline config editing with global hotkey suppression
- [x] TUI: Uninstall Plugin action with y/n confirmation and auto-exit
- [x] TUI: Uninstall deregisters from Claude CLI plugin registry
- [x] Python source fully removed (cleanup done early)
- [x] Node >= 20.12 required (dropped Node 18 for @inquirer/prompts compatibility)
- [x] 228 tests passing across 16 test files
- [ ] `config show --sources` displays where each value comes from (deferred)

---

## Step 3: Ollama backend — basic text relay (PR → 1.0.0-alpha.3)

### Ollama API overview

Ollama exposes a local HTTP API at `http://localhost:11434`:
- `/api/chat` — chat completions with tool-calling support
- `/api/generate` — raw text generation
- Tool-calling works with `qwen3`, `llama3.1`, `mistral`, `llama4`, `command-r+`, etc.
- Models must be pre-pulled locally (`ollama pull <model>`)

### Design decisions

- **HTTP client**: Native `fetch` — no deps
- **Sandbox**: No-op — Ollama is pure inference, accepts all sandbox values
- **Model resolution**: `--model` > `OLLAMA_MODEL` env > config > server default > fail with `ollama pull` guidance
- **Host**: `OLLAMA_HOST` env var > config > `http://localhost:11434`
- **Error handling**: Failure-path diagnostics — call `/api/chat` directly, on failure probe `/api/tags` for actionable "Is Ollama running?" message

### New files

```
src/backends/ollama.ts
tests/backends/ollama.test.ts
```

### Acceptance criteria

- [ ] `phone-a-friend --to ollama --repo . --prompt "Hello"` returns a response
- [ ] Clear error when Ollama server not reachable: "Is Ollama running?"
- [ ] Model resolution chain: `--model` > `OLLAMA_MODEL` > config > server default
- [ ] Host override via `OLLAMA_HOST` and config
- [ ] `phone-a-friend doctor` shows Ollama status correctly

---

## Step 4: OpenAI API backend (PR → 1.0.0-alpha.4)

### New files

```
src/backends/openai.ts       # fetch POST to api.openai.com/v1/chat/completions
tests/backends/openai.test.ts
```

### Acceptance criteria

- [ ] `OPENAI_API_KEY=sk-... phone-a-friend --to openai --repo . --prompt "Hello"` works
- [ ] Missing API key gives clear error
- [ ] HTTP 429 surfaces provider's retry message
- [ ] `phone-a-friend doctor` shows openai as available when key is set

---

## Step 5: Google AI + Anthropic API backends (PR → 1.0.0-alpha.5)

### New files

```
src/backends/google.ts       # fetch POST to generativelanguage.googleapis.com
src/backends/anthropic.ts    # fetch POST to api.anthropic.com/v1/messages
tests/backends/google.test.ts
tests/backends/anthropic.test.ts
```

### Acceptance criteria

- [ ] All 6 backends register and appear in `--help`
- [ ] Each API backend: missing key error, happy path, HTTP error surfacing
- [ ] `phone-a-friend setup` and `doctor` show all backends correctly

---

## Step 6: Documentation + cleanup (PR → 1.0.0-rc.1) — PARTIALLY COMPLETE

- [ ] `README.md` — Full rewrite: standalone CLI identity, all 6 backends, `npm install -g`
- [x] `CLAUDE.md` / `AGENTS.md` — Updated CLI contract for TypeScript version
- [x] `plans/roadmap.md` — Update with completed items
- [x] Python source removed (`phone_a_friend/`, `pyproject.toml`, Python tests) — done early in Step 2
- [ ] Archive `plans/ollama-backend.md` — already has superseded note

---

## Step 7: Ollama read-only tool-calling (PR → 1.0.0)

> **Absorbed from**: `ollama-backend.md` Phase 2A.

### Tool definitions (read-only only)

| Tool | Description | Sandbox |
|------|-------------|---------|
| `read_file` | Read a file from the repo | all modes |
| `list_directory` | List files in a directory | all modes |
| `search_files` | Grep for a pattern in the repo | all modes |

### Agent loop

```
Build prompt → fetch /chat → Parse response
                                    │
                         ┌──────────┴──────────┐
                    tool_calls?            text content?
                         │                     │
                    Execute tools          Return result
                         │
                    Append results → loop back to fetch /chat
```

### Safety guardrails

- `--max-turns N` — hard limit on loop iterations (default: 10)
- Per-tool output size limit
- Path traversal protection — resolve within `repoPath`, reject escaping symlinks
- Cycle detection — break on repeated identical tool calls
- Deterministic termination — max-turns OR text response OR error

### New files

```
src/tools/index.ts           # Tool registry and types
src/tools/filesystem.ts      # read_file, list_directory, search_files
src/agent-loop.ts            # Multi-turn conversation loop with tool dispatch
tests/tools/filesystem.test.ts
tests/agent-loop.test.ts
```

### Acceptance criteria

- [ ] `--to ollama --tools --prompt "Read main.py and summarize"` triggers tool-calling
- [ ] `--no-tools` (default) returns single-shot text response
- [ ] `--max-turns` stops the loop at the limit
- [ ] Path traversal outside `repoPath` is rejected
- [ ] Cycle detection breaks infinite loops

---

## Step 8: Ollama mutating tool-calling (PR → 1.1.0)

> **Absorbed from**: `ollama-backend.md` Phase 2B. Requires Step 7 stable.

### Mutating tools (gated by sandbox)

| Tool | Description | Sandbox |
|------|-------------|---------|
| `write_file` | Write/overwrite a file | workspace-write, danger-full-access |
| `run_command` | Execute a shell command | danger-full-access only |

### New files

```
src/tools/write.ts
src/tools/shell.ts
tests/tools/write.test.ts
tests/tools/shell.test.ts
```

---

## Step 9: Polish (PR → 1.2.0)

1. `--to auto` support (roadmap item #1) with fallback across backends
2. Model recommendations in `--help` output
3. Streaming support for HTTP backends

---

## Project structure (final)

```
phone-a-friend/
├── src/
│   ├── index.ts
│   ├── cli.ts               # Commander.js
│   ├── relay.ts              # Core relay logic
│   ├── context.ts            # RelayContext interface
│   ├── config.ts             # TOML config loading/merging
│   ├── detection.ts          # Three-category backend detection
│   ├── setup.ts              # Interactive wizard (Inquirer.js)
│   ├── doctor.ts             # Health check (chalk + --json)
│   ├── installer.ts          # Claude plugin management
│   ├── agent-loop.ts         # Multi-turn tool-calling loop
│   ├── backends/
│   │   ├── index.ts          # Registry + types
│   │   ├── codex.ts          # Subprocess
│   │   ├── gemini.ts         # Subprocess
│   │   ├── ollama.ts         # fetch
│   │   ├── openai.ts         # fetch
│   │   ├── google.ts         # fetch
│   │   └── anthropic.ts      # fetch
│   └── tools/
│       ├── index.ts          # Tool registry
│       ├── filesystem.ts     # read_file, list_directory, search_files
│       ├── write.ts          # write_file
│       └── shell.ts          # run_command
├── tests/                    # Mirrors src/ structure
├── dist/                     # Built output (tsup)
├── .claude-plugin/
│   └── plugin.json
├── commands/                 # Claude plugin slash commands
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── plans/
```

---

## Architectural decisions

| Decision | Choice | Why |
|----------|--------|-----|
| **Language** | TypeScript | Native npm, rich CLI ecosystem, no Python dep |
| **CLI UX first** | Build setup/doctor/detection before backends | DX is the product; backends plug into polished UX |
| Relay vs Host | `claude` is a host integration, not a relay backend | Prevents count confusion; different concerns |
| `plugin` subcommand | `plugin install/update/uninstall` | Reserves `update` for future CLI self-update |
| Post-setup test | Offered after config save | Converts "configured" to "verified" |
| `doctor --json` | From day one | Agents, CI, bug reports need structured output |
| Config format | TOML | Human-readable, supports comments, familiar |
| TOML library | smol-toml | Tiny, zero-dep, read + write |
| API key storage | Env vars only (config stores var name) | Never risk committing secrets |
| Backend naming | Separate names per transport | Explicit, no mode matrix |
| HTTP client | Native `fetch` | Built into Node 18+, zero deps |
| CLI framework | Commander.js | One framework, not Typer+argparse dual |
| Interactive prompts | Inquirer.js | Arrow-key selection, the gold standard |
| Distribution | npm (native) | No Python dep, no launcher hacks |
| API key plumbing | `env` in `RelayContext`, not `process.env` mutation | Explicit, testable, no global side effects |
| Tool-calling scope | Ollama-internal | Extract shared interface when second backend needs it |
| Tool-calling default | `--no-tools` | Safer for existing one-shot relay expectations |
| Python source | Kept during port as reference spec | Deleted after TS version verified stable |

---

## Security considerations

- Ollama runs locally at `127.0.0.1:11434` — no remote exposure by default
- No API authentication for Ollama — anyone on localhost can access
- Tool execution respects `--sandbox` mode
- `--max-turns` prevents runaway agent loops
- Path traversal protection on all filesystem tools
- Per-tool output size limits prevent context explosion
- Depth guard (`PHONE_A_FRIEND_DEPTH`) prevents recursive relay

---

## Open questions

1. **npm namespace**: Is `phone-a-friend` available on npm? Fallback: `@paf/cli` or `phone-a-friend-cli`.
2. **Google API endpoint**: AI Studio (`generativelanguage.googleapis.com`) vs Vertex AI. Plan targets AI Studio.
3. **Streaming**: Deferred to Step 9 but prioritized per Gemini feedback.
4. ~~**Typer + argparse dual maintenance**~~: Resolved — TypeScript uses Commander.js only.
5. ~~**Plugin-CLI coupling**~~: Resolved by native npm.
6. **Windows support**: `execFile` works on Windows but paths need care. Not a priority target.
7. ~~**Future Python dependencies**~~: No longer relevant — pure TypeScript.
8. **Max context window**: Ollama models vary (4K-256K). Don't limit on our side — let Ollama handle truncation.
9. **Claude plugin structure**: `.claude-plugin/` and `commands/` must be preserved as-is for Claude Code compatibility. The TS build output goes to `dist/`, npm `files` includes both.

---

## Review history

### Round 1 (Codex via phone-a-friend) — ollama-backend.md

10 findings. Key: split Phase 2 into 2A/2B, keep `check_backends()` PATH-only, change `--tools` default to off, add safety guardrails, harden error handling.

### Round 2 (Codex via phone-a-friend) — ollama-backend.md

Settled failure-path diagnostics (middle ground). Agreed to keep tool-calling internal to OllamaBackend.

### Round 3 (Codex via phone-a-friend) — evolution plan

8 findings: dual-mode framing, API key conflict, `check_backends()` scope, env vars unspecified, `_normalize_argv`, PyPI gap, roadmap alignment, test impact.

### Round 4 (Codex via phone-a-friend) — evolution plan

5 findings: `env_overlay` plumbing, `check_api_backends()` config-awareness, `INSTALL_HINTS` for API backends, pip packaging invalid, roadmap #2 over-claimed.

### Round 5 (Codex + Gemini via phone-a-team) — evolution plan, high-level

Both agreed: good direction. Consensus on `RelayContext` + `env_overlay` over `os.environ` mutation.

### Round 6 (Codex + Gemini via phone-a-team) — npm analysis

Both agreed: npm as primary distribution. Eliminates `_plugin_data/` complexity.

### Round 7 (Codex + Gemini via phone-a-team) — merge analysis

Both agreed: don't implement Ollama separately. Build shared foundations first to avoid rework. Ollama availability contradiction resolved (runtime-only, not in `INSTALL_HINTS`).

### Round 8 — CLI UX priority (user-driven)

User established CLI experience as THE priority. Added setup wizard, doctor, three-category backend detection, smart first-run, install hints. Restructured step ordering.

### Round 9 (Codex + Gemini via phone-a-team) — CLI UX plan review

Both agreed: strong plan. Applied feedback: relay vs host separation, `plugin` subcommand namespace, `doctor --json`, `config paths`/`edit`, typed `config set`, post-setup test, tagline, auto-select, alias suggestion.

### Round 10 (Codex + Gemini via phone-a-team) — Python vs TypeScript

**Codex recommended TypeScript**: installer DX friction (npm + Python dep), dual framework maintenance, target audience in Node ecosystem, small codebase (~890 lines).
**Gemini recommended staying Python**: existing investment, Rich + InquirerPy capable, rewrite risk.
**Decision**: TypeScript. The codebase is small, the port is straightforward, and the npm + Python dependency is a fundamental DX contradiction that would never go away. User approved.

---

*Supersedes: `plans/ollama-backend.md` (Phase 1 → Step 3, Phase 2A → Step 7, Phase 2B → Step 8, Phase 3 → Step 9)*

*Research sources: [Ollama Tool Calling Docs](https://docs.ollama.com/capabilities/tool-calling), [Ollama API Reference](https://docs.ollama.com/api), [Commander.js](https://github.com/tj/commander.js), [Inquirer.js](https://github.com/SBoudrias/Inquirer.js)*

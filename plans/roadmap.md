# phone-a-friend Roadmap

Current status and future development plans.

## Completed

### TypeScript rewrite (Step 1) — v1.0.0-alpha.1
- Full port from Python to TypeScript
- Commander.js CLI, vitest tests, tsup build
- Self-contained `dist/` for symlink plugin installs
- CI on Node 20/22, version sync enforcement
- Python source removed

### CLI UX Foundation (Step 2) — v1.1.0-alpha.1
- Interactive setup wizard with Inquirer.js
- Doctor health check (human + `--json` output)
- Three-category backend detection (CLI, Local, API + Host integrations)
- TOML configuration system (user + repo config, dot-notation set/get)
- Branded CLI UX (banner, rich errors, spinners, colored doctor output)
- **Interactive TUI dashboard** (Ink/React):
  - 4 tabs: Status, Backends, Config, Actions
  - Inline config editing with global hotkey suppression
  - Uninstall Plugin with y/n confirmation and auto-exit
  - Uninstall deregisters from Claude CLI plugin registry
- Repo-level config (`.phone-a-friend.toml`)
- 228 tests across 16 test files
- Multiple Codex review rounds hardened the implementation

## Next Up

### Step 3: Ollama backend — basic text relay (→ v1.0.0-alpha.3)

**Priority: High** — First HTTP API backend, local inference.

- `phone-a-friend --to ollama --repo . --prompt "Hello"`
- Native `fetch` to `http://localhost:11434/api/chat`
- Model resolution: `--model` > `OLLAMA_MODEL` env > config > server default
- Host override via `OLLAMA_HOST` and config
- Failure-path diagnostics: "Is Ollama running?" on connection failure

### Step 4: OpenAI API backend (→ v1.0.0-alpha.4)

- `phone-a-friend --to openai --repo . --prompt "Hello"`
- `fetch` POST to `api.openai.com/v1/chat/completions`
- API key from `OPENAI_API_KEY` env var

### Step 5: Google AI + Anthropic API backends (→ v1.0.0-alpha.5)

- Google AI: `fetch` POST to `generativelanguage.googleapis.com`
- Anthropic: `fetch` POST to `api.anthropic.com/v1/messages`
- All 6 backends registered and visible in setup/doctor

## Future

### Backend fallback (`--to auto`)

- Try preferred backend, fall back on timeout/error
- Optional `--to both` compare mode
- Configurable fallback order

### Structured output (`--format json`)

- `--format json` emits: `backend`, `model`, `sandbox`, `duration_ms`, `status`, `message`
- `--save-run <dir>` persists prompt, context, and response metadata

### Smarter context packing

- `--context-glob "src/**/*.ts"` to include multiple files
- `--exclude "*.test.*"` to filter out test files
- `--dry-run` to preview exact bytes/files before relay

### Ollama tool-calling (Steps 7-8)

- Read-only tools: `read_file`, `list_directory`, `search_files`
- Mutating tools (gated by sandbox): `write_file`, `run_command`
- Multi-turn agent loop with safety guardrails

### End-to-end CLI tests

- Fake `codex`/`gemini` fixture binaries
- Real subprocess lifecycle tests

---

*Last updated: 2026-02-22*

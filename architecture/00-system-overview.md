# System Overview

`phone-a-friend` is a TypeScript CLI relay and Claude Code plugin that routes task prompts plus repository context to external coding backends (`codex`, `gemini`, or `ollama`). The `/phone-a-friend` command provides one-shot relay, `--review` provides diff-scoped code review, and `/phone-a-team` adds iterative, multi-round refinement on top of the relay.

## High-Level Architecture

```mermaid
flowchart LR
  U[User in Claude Code] --> SC[Slash Command Runtime]

  subgraph Plugin["Claude Plugin Source (repo)"]
    C1["commands/phone-a-friend.md"]
    C2["commands/phone-a-team.md"]
    IDX["src/index.ts (entry point)"]
    CLI["src/cli.ts (Commander.js)"]
    R["src/relay.ts"]
    CTX["src/context.ts"]
    DET["src/detection.ts"]
    CFG["src/config.ts"]
    DOC["src/doctor.ts"]
    SET["src/setup.ts"]
    THM["src/theme.ts"]
    DSP["src/display.ts"]
    BREG["src/backends/index.ts"]
    BC["src/backends/codex.ts"]
    BG["src/backends/gemini.ts"]
    BO["src/backends/ollama.ts"]
    INST["src/installer.ts"]
    TUI["src/tui/"]
    PM[".claude-plugin/marketplace.json"]
    PJ[".claude-plugin/plugin.json"]
  end

  SC --> C1
  SC --> C2

  C1 --> IDX
  C2 --> IDX
  IDX --> CLI
  CLI --> R
  R --> BREG
  BREG --> BC
  BREG --> BG
  BREG --> BO
  BC --> COD["codex CLI"]
  BG --> GEM["gemini CLI"]
  BO --> OLL["Ollama HTTP API"]

  CLI --> INST
  INST --> CP["~/.claude/plugins/phone-a-friend"]
  INST --> CCLI["claude plugin marketplace/install/enable/update"]
  INST --> BCHK["Backend availability check"]
```

## One-Shot, Review, and Iterative Entry Points

```mermaid
sequenceDiagram
  participant User
  participant Claude
  participant Slash
  participant CLI as phone-a-friend
  participant Relay as relay.ts
  participant Backend as codex/gemini/ollama

  User->>Claude: /phone-a-friend <request>
  Claude->>Slash: execute commands/phone-a-friend.md workflow
  Slash->>CLI: run relay command once
  CLI->>Relay: relay(prompt, repo, options)
  Relay->>Backend: await run(...)
  Backend-->>Relay: feedback text
  Relay-->>CLI: final message
  CLI-->>Claude: stdout
  Claude-->>User: concise review

  User->>Claude: /phone-a-friend --review [--base main]
  Claude->>Slash: execute review workflow
  Slash->>CLI: run relay --review --base ...
  CLI->>Relay: reviewRelay(repoPath, base, options)
  alt Backend has native review()
    Relay->>Backend: await review(repoPath, base, ...)
  else Generic fallback
    Relay->>Relay: gitDiffBase(repoPath, base)
    Relay->>Backend: await run(prompt + diff)
  end
  Backend-->>Relay: review feedback
  Relay-->>CLI: final message
  CLI-->>Claude: stdout
  Claude-->>User: code review

  User->>Claude: /phone-a-team <task> [--backend ...]
  Claude->>Slash: execute commands/phone-a-team.md workflow
  loop Up to MAX_ROUNDS rounds (default 3, configurable 1–5)
    Slash->>CLI: one or more relay calls
    CLI->>Relay: relay(...)
    Relay->>Backend: await run(...)
    Backend-->>Relay: output or error
    Relay-->>CLI: result
    Slash->>Slash: do-review-decide
  end
  Claude-->>User: final synthesis
```

## Key Components and Responsibilities

| Component | File | Role |
|-----------|------|------|
| One-shot slash command | `commands/phone-a-friend.md` | Prompt policy for one-shot relay (with optional review mode) |
| Iterative slash command | `commands/phone-a-team.md` | Prompt policy for multi-round refinement loop |
| Entry point | `src/index.ts` | Imports backends (self-register), runs CLI |
| CLI parser | `src/cli.ts` | Commander.js with subcommands: relay, setup, doctor, config, plugin |
| Relay core | `src/relay.ts` | Backend-agnostic orchestration: `relay()` + `reviewRelay()`, prompt assembly, limits, depth guard |
| Relay context types | `src/context.ts` | `RelayContext` interface definition |
| Backend registry | `src/backends/index.ts` | Backend interface, registry, types (`BackendResult`, `ReviewOptions`), error hierarchy |
| Codex adapter | `src/backends/codex.ts` | Subprocess adapter for `codex exec` with native `review()` |
| Gemini adapter | `src/backends/gemini.ts` | Subprocess adapter for `gemini --prompt` |
| Ollama adapter | `src/backends/ollama.ts` | HTTP adapter for Ollama API (`fetch`) |
| Backend detection | `src/detection.ts` | CLI, Local (Ollama), and Host (Claude) backend detection with environment status |
| Config | `src/config.ts` | TOML configuration system with layered resolution |
| Doctor | `src/doctor.ts` | Health check command — human-readable and JSON output |
| Setup wizard | `src/setup.ts` | Interactive setup for first-time configuration |
| Theme | `src/theme.ts` | Shared terminal styling (colors, symbols, banner) |
| Display | `src/display.ts` | Formatted output helpers |
| Installer | `src/installer.ts` | Install/update/uninstall plugin, marketplace sync |
| TUI | `src/tui/` | Interactive Ink (React) dashboard with 4 tabs |
| Plugin identity | `.claude-plugin/plugin.json` | Plugin name, version, author |
| Marketplace source | `.claude-plugin/marketplace.json` | Marketplace name and source mapping |

## Data Flow

1. User invokes slash command in Claude Code.
2. Slash command prompt file determines run policy (`/phone-a-friend` one-shot, `/phone-a-team` iterative).
3. Command executes `phone-a-friend relay --prompt ...` (with optional `--review` and `--base` flags for review mode).
4. CLI parses args and calls relay, review relay, or installer path.
5. For standard relay: composes full backend prompt from request, optional context, optional git diff, and repo metadata.
6. For review relay: resolves base branch (auto-detects `main`/`master`/`HEAD~1`), tries native `backend.review()` if available, falls back to generic diff relay via `backend.run()`.
7. Relay selects backend adapter and executes: subprocess for CLI backends (codex, gemini) or HTTP fetch for Ollama.
8. All backends return `Promise<string>` — relay awaits the result.
9. Backend output is returned to Claude session for synthesis.
10. Installer commands optionally sync plugin registration with `claude plugin` subcommands and report backend availability.

## Important Design Decisions and Constraints

- One-shot relay engine is code-enforced; `/phone-a-team` behavior is prompt-enforced policy (no runtime loop enforcement).
- Default sandbox is `read-only`; broader modes are opt-in.
- Relay guards recursion with `PHONE_A_FRIEND_DEPTH`.
- Prompt/context/diff limits are hard byte caps to prevent oversized relays.
- Plugin version must remain synchronized between `package.json` and `.claude-plugin/plugin.json` (CI/release checks).
- Installer supports both symlink and copy to balance dev velocity vs isolated installs.
- All backend `run()` methods return `Promise<string>`, enabling both subprocess and HTTP backends.
- Built bundle in `dist/` is committed for self-contained symlink installs.
- Review relay uses dual-path strategy: native `backend.review()` (Codex only) with generic diff fallback for other backends.

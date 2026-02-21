# System Overview

`phone-a-friend` is a Python CLI relay and Claude Code plugin that routes task prompts plus repository context to external coding backends (`codex` or `gemini`). In `v0.2.0`, `/phone-a-team` adds iterative, multi-round refinement on top of the existing one-shot `/phone-a-friend` relay.

## High-Level Architecture

```mermaid
flowchart LR
  U[User in Claude Code] --> SC[Slash Command Runtime]

  subgraph Plugin["Claude Plugin Source (repo)"]
    C1["commands/phone-a-friend.md"]
    C2["commands/phone-a-team.md"]
    W["./phone-a-friend (shell wrapper)"]
    CLI["phone_a_friend/cli.py"]
    R["phone_a_friend/relay.py"]
    BREG["phone_a_friend/backends/__init__.py"]
    BC["phone_a_friend/backends/codex.py"]
    BG["phone_a_friend/backends/gemini.py"]
    INST["phone_a_friend/installer.py"]
    PM[".claude-plugin/marketplace.json"]
    PJ[".claude-plugin/plugin.json"]
  end

  SC --> C1
  SC --> C2

  C1 --> W
  C2 --> W
  W --> CLI
  CLI --> R
  R --> BREG
  BREG --> BC
  BREG --> BG
  BC --> COD["codex CLI"]
  BG --> GEM["gemini CLI"]

  CLI --> INST
  INST --> CP["~/.claude/plugins/phone-a-friend"]
  INST --> CCLI["claude plugin marketplace/install/enable/update"]
  INST --> BCHK["Backend availability check"]
```

## One-Shot vs Iterative Entry Points

```mermaid
sequenceDiagram
  participant User
  participant Claude
  participant Slash
  participant CLI as ./phone-a-friend
  participant Relay as relay.py
  participant Backend as codex/gemini CLI

  User->>Claude: /phone-a-friend <request>
  Claude->>Slash: execute commands/phone-a-friend.md workflow
  Slash->>CLI: run relay command once
  CLI->>Relay: relay(prompt, repo, options)
  Relay->>Backend: run(...)
  Backend-->>Relay: feedback text
  Relay-->>CLI: final message
  CLI-->>Claude: stdout
  Claude-->>User: concise review

  User->>Claude: /phone-a-team <task> [--backend ...]
  Claude->>Slash: execute commands/phone-a-team.md workflow
  loop Up to 3 rounds
    Slash->>CLI: one or more relay calls
    CLI->>Relay: relay(...)
    Relay->>Backend: run(...)
    Backend-->>Relay: output or error
    Relay-->>CLI: result
    Slash->>Slash: do-review-decide
  end
  Claude-->>User: final synthesis
```

## Key Components and Responsibilities

| Component | File | Role |
|-----------|------|------|
| One-shot slash command | `commands/phone-a-friend.md` | Prompt policy for single-relay review |
| Iterative slash command | `commands/phone-a-team.md` | Prompt policy for multi-round refinement loop |
| Shell wrapper | `phone-a-friend` | Resolves Python 3 and executes `python -m phone_a_friend.cli` |
| CLI parser | `phone_a_friend/cli.py` | Command parsing, dispatch to relay/installer, backend status |
| Relay core | `phone_a_friend/relay.py` | Backend-agnostic orchestration, prompt assembly, limits, depth guard |
| Backend adapters | `phone_a_friend/backends/*` | Concrete adapters for Codex and Gemini CLIs |
| Installer | `phone_a_friend/installer.py` | Install/update/uninstall plugin, marketplace sync |
| Plugin identity | `.claude-plugin/plugin.json` | Plugin name, version, author |
| Marketplace source | `.claude-plugin/marketplace.json` | Marketplace name and source mapping |

## Data Flow

1. User invokes slash command in Claude Code.
2. Slash command prompt file determines run policy (`/phone-a-friend` one-shot, `/phone-a-team` iterative).
3. Command executes `./phone-a-friend ...`.
4. CLI parses args and calls relay or installer path.
5. Relay composes full backend prompt from request, optional context, optional git diff, and repo metadata.
6. Relay selects backend adapter and executes backend CLI subprocess.
7. Backend output is returned to Claude session for synthesis.
8. Installer commands optionally sync plugin registration with `claude plugin` subcommands and report backend availability.

## Important Design Decisions and Constraints

- One-shot relay engine is code-enforced; `/phone-a-team` behavior is prompt-enforced policy (no runtime loop enforcement).
- Default sandbox is `read-only`; broader modes are opt-in.
- Relay guards recursion with `PHONE_A_FRIEND_DEPTH`.
- Prompt/context/diff limits are hard byte caps to prevent oversized relays.
- Plugin version must remain synchronized between `pyproject.toml` and `.claude-plugin/plugin.json` (CI/release checks).
- Installer supports both symlink and copy to balance dev velocity vs isolated installs.

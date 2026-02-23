# Phone-a-Team Iterative Loop

`/phone-a-team` is an iterative orchestration layer defined in `commands/phone-a-team.md`. It runs a structured do-review-decide loop (default 3 rounds, configurable 1–5 via `--max-rounds`) over one or more backends via `phone-a-friend`, with optional Claude agent-team acceleration and deterministic fallback behavior.

> **Note:** `/phone-a-team` is a prompt policy, not compiled code. The diagrams below describe the behavior enforced by the slash command prompt file (`commands/phone-a-team.md`), not runtime code paths. There is no loop construct in the TypeScript source — Claude's agent runtime follows the prompt instructions to iterate.

## Loop Architecture

```mermaid
flowchart TD
  A["Parse ARGUMENTS"] --> B{"Valid --backend?"}
  B -- invalid value --> E1["Abort: valid values are codex, gemini, ollama, both"]
  B -- valid/default --> C["Extract TASK_DESCRIPTION"]
  C --> D{Task empty?}
  D -- yes --> E2[Ask user for task]
  D -- no --> F["Preflight: which checks"]

  F --> G{Requested backend availability}
  G -- "single, missing" --> E3[Abort with install hint]
  G -- "both, both missing" --> E4[Abort: no backends]
  G -- "both, one missing" --> H[Degrade to available + warn]
  G -- available --> I[Attempt agent-team creation]

  I --> J{Team creation succeeds?}
  J -- yes --> K[Use team mode]
  J -- no --> L[Fallback to sequential]

  K --> M["ROUND 1"]
  L --> M

  M --> N["DO: delegate / work / split"]
  N --> O["REVIEW: convergence rubric"]
  O --> P{DECIDE}
  P -- converged --> Z["FINAL SYNTHESIS"]
  P -- backend failure --> Q[Handle failure]
  P -- issues found --> R[Generate actionable feedback]

  Q --> S{"Round < MAX_ROUNDS and backend available?"}
  R --> T{"Round < MAX_ROUNDS?"}
  S -- yes --> U[Next round with focused context]
  S -- no --> Y["Forced stop: synthesis with unresolved items"]
  T -- yes --> U
  T -- no --> Y
  U --> N
  Y --> Z
```

## Round Lifecycle State Diagram

```mermaid
stateDiagram-v2
  [*] --> Parsing
  Parsing --> Preflight
  Preflight --> TeamSetup
  TeamSetup --> Round1

  state "Round N" as RoundN {
    [*] --> DO
    DO --> REVIEW
    REVIEW --> DECIDE
    DECIDE --> Converged: all rubric items pass
    DECIDE --> NextRound: issues found and round < MAX_ROUNDS
    DECIDE --> ForcedStop: issues found and round = MAX_ROUNDS
    DECIDE --> HandleFailure: backend error
    HandleFailure --> NextRound: retry available
    HandleFailure --> ForcedStop: no recovery
  }

  Round1 --> Round2: not converged
  Round2 --> RoundN: not converged (up to MAX_ROUNDS)
  Round1 --> Synthesis: converged
  Round2 --> Synthesis: converged
  RoundN --> Synthesis: converged or forced stop

  Synthesis --> [*]
```

## Team Mode vs Sequential Fallback

```mermaid
sequenceDiagram
  participant Lead as Claude Lead
  participant Team as Agent Team (optional)
  participant PAF as phone-a-friend
  participant Codex as codex backend
  participant Gemini as gemini backend
  participant Ollama as ollama backend

  Lead->>Lead: Parse --backend and task
  Lead->>Lead: Preflight backend checks

  alt Team creation succeeds
    Lead->>Team: Create one team for session
    Team->>PAF: Delegate round tasks in parallel
  else Team unavailable/fails
    Lead->>PAF: Run sequentially in current session
  end

  alt backend=both (codex + gemini)
    par Backend lane 1
      PAF->>Codex: relay call
      Codex-->>PAF: output/error
    and Backend lane 2
      PAF->>Gemini: relay call
      Gemini-->>PAF: output/error
    end
  else single backend
    PAF->>Codex: relay call (or Gemini/Ollama)
    Codex-->>PAF: output
  end

  Lead->>Lead: Review against rubric
  Lead->>Lead: Decide: converge / iterate / stop
```

## Argument Parsing

| Input | Result |
|-------|--------|
| `--backend codex` | BACKEND = `codex` |
| `--backend gemini` | BACKEND = `gemini` |
| `--backend ollama` | BACKEND = `ollama` |
| `--backend both` | BACKEND = `both` |
| No `--backend` flag | BACKEND = `codex` (default) |
| `--backend invalid` | Error and stop |
| Empty task after parsing | Ask user before proceeding |

## Preflight and Degradation Rules

| BACKEND | codex available | gemini available | Action |
|---------|-----------------|------------------|--------|
| `codex` | yes | -- | Proceed |
| `codex` | no | -- | Abort with install hint |
| `gemini` | -- | yes | Proceed |
| `gemini` | -- | no | Abort with install hint |
| `ollama` | -- | -- | Proceed (HTTP, no binary check) |
| `both` | yes | yes | Proceed with both |
| `both` | yes | no | Degrade to codex + warn |
| `both` | no | yes | Degrade to gemini + warn |
| `both` | no | no | Abort: no backends |

## Convergence Rubric

All three items must pass for convergence:

1. **Acceptance criteria met** -- Does the output accomplish the task as described?
2. **No critical risks or correctness issues** -- Free of bugs, security issues, logical errors, significant omissions?
3. **Validation done** -- Output checked (tests run, code reviewed, logic verified)? If skipped, is there a documented reason?

## Context Budget Management

Each relay call sends only:
- Original task description
- Latest output or delta from previous round
- 2-3 sentence summary of prior rounds (if referencing them)

No full conversation history. No accumulated prior outputs. Rationale: stay within relay caps (200 KB context, 300 KB diff, 500 KB prompt).

## Sandbox Escalation Policy

```mermaid
flowchart LR
  A["Default: --sandbox read-only"] --> B{Task needs writes?}
  B -- no --> C["Keep read-only"]
  B -- yes --> D["Escalate to workspace-write"]
  D --> E["Disclose in final synthesis"]
```

## Backend Failure Handling Matrix

| Scenario | Action |
|----------|--------|
| Single backend requested and available | Normal loop |
| Single backend requested but missing | Abort with install hint |
| Both requested, one missing at preflight | Degrade to available backend |
| Both requested, one fails mid-loop | Continue with remaining, note failure |
| Both requested, both fail mid-loop | Stop loop; synthesize failure summary |
| Backend returns 429 (rate limited) | Skip for current round, retry next |
| Backend timeout/crash | Treat as round failure; retry next round |

## Important Design Decisions and Constraints

- Default loop cap is 3 rounds, configurable 1–5 via `--max-rounds`.
- Early stop on convergence is required (no unnecessary iterations).
- Feature is prompt policy, not runtime-enforced code.
- No re-entrancy: do not nest `/phone-a-team` within `/phone-a-team`.
- One team per session when team mode is used.
- Teammates use `mode: "bypassPermissions"` to avoid blocking the user with permission prompts.
- `/phone-a-team` treats `phone-a-friend` internals as a black box.
- Token usage is higher than single `/phone-a-friend` (multiple relay calls + review overhead).

# Relay Core

`phone_a_friend/relay.py` is the backend-agnostic execution core. It validates relay inputs, resolves context, optionally captures `git diff`, builds a normalized prompt envelope, enforces size limits, applies depth guard protection, and delegates execution to a selected backend adapter.

## Relay Processing Flow

```mermaid
flowchart TD
  A[relay called] --> B{prompt non-empty?}
  B -- no --> E1[RelayError: Prompt is required]
  B -- yes --> C{timeout > 0?}
  C -- no --> E2[RelayError: Timeout must be greater than zero]
  C -- yes --> D{repo exists and is dir?}
  D -- no --> E3[RelayError: invalid repo path]
  D -- yes --> G[get_backend backend_name]
  G --> H{backend found?}
  H -- no --> E4[RelayError: unsupported backend]
  H -- yes --> I{sandbox in backend.allowed_sandboxes?}
  I -- no --> E5[RelayError: invalid sandbox]

  I -- yes --> J[resolve context]
  J --> J1{both context_file and context_text?}
  J1 -- yes --> E6[RelayError]
  J1 -- no --> J2[read context file if provided]
  J2 --> J3[enforce 200 KB context limit]

  J3 --> K{include_diff?}
  K -- yes --> K1[run git -C repo diff]
  K1 --> K2{git diff ok?}
  K2 -- no --> E7[RelayError: diff collection failed]
  K2 -- yes --> K3[enforce 300 KB diff limit]
  K -- no --> L

  K3 --> L[build full prompt envelope]
  L --> M[enforce 500 KB prompt limit]
  M --> N[depth guard PHONE_A_FRIEND_DEPTH]
  N --> N1{depth >= MAX_RELAY_DEPTH?}
  N1 -- yes --> E8[RelayError: depth limit reached]
  N1 -- no --> O[set env depth+1]
  O --> P[selected_backend.run ...]
  P --> Q{BackendError?}
  Q -- yes --> E9[RelayError str BackendError]
  Q -- no --> R[return backend feedback]
```

## Prompt Envelope Structure

`_build_prompt(...)` constructs a consistent structure sent to every backend:

```
You are helping another coding agent by reviewing or advising on work in a local repository.
Repository path: /path/to/repo
Use the repository files for context when needed.
Respond with concise, actionable feedback.

Request:
<user prompt>

Additional Context:        (optional, if context_text provided)
<context text>

Git Diff:                  (optional, if include_diff=True)
<diff output>
```

This normalization keeps backend prompts consistent across Codex and Gemini.

## Size Limit Enforcement

| Limit | Constant | Value |
|-------|----------|-------|
| Context | `MAX_CONTEXT_FILE_BYTES` | 200,000 bytes |
| Diff | `MAX_DIFF_BYTES` | 300,000 bytes |
| Final prompt | `MAX_PROMPT_BYTES` | 500,000 bytes |

Measurement uses UTF-8 bytes (`len(text.encode("utf-8"))`), not character count.

## Depth Guard Mechanism

```mermaid
sequenceDiagram
  participant Env as Environment
  participant Relay as _next_relay_env
  participant Backend as Backend subprocess

  Env->>Relay: read PHONE_A_FRIEND_DEPTH (default "0")
  Relay->>Relay: parse int, fallback 0 on invalid
  alt depth >= MAX_RELAY_DEPTH (1)
    Relay-->>Env: RelayError depth limit reached
  else depth < MAX_RELAY_DEPTH
    Relay->>Relay: set env PHONE_A_FRIEND_DEPTH = depth + 1
    Relay->>Backend: run with updated env
  end
```

- `MAX_RELAY_DEPTH = 1` means no nested relay inside an active relay execution.
- Invalid env value is tolerated by coercing to `0`.

## Key Components and Responsibilities

| Function | Role |
|----------|------|
| `_resolve_context_text` | Enforces mutual exclusivity of file/text context, delegates file reads |
| `_read_context_file` | File existence/type/readability checks and context-size enforcement |
| `_git_diff` | Executes `git diff` and validates return code |
| `_build_prompt` | Deterministic prompt assembly into envelope structure |
| `_next_relay_env` | Recursion guard via env depth tracking |
| `relay` | Orchestration entry point: validation, dispatch, unified error surface |
| `relay_to_codex` | Backward-compatible alias for `relay` |

## Error Handling Chain

```mermaid
classDiagram
  class RuntimeError
  class BackendError
  class RelayError
  class CodexBackendError
  class GeminiBackendError

  RuntimeError <|-- BackendError
  RuntimeError <|-- RelayError
  BackendError <|-- CodexBackendError
  BackendError <|-- GeminiBackendError
```

- Relay catches only `BackendError` from adapters and rethrows as `RelayError`.
- Validation and git/context/prompt/depth failures raise `RelayError` directly.
- Result: CLI sees one relay-level error type for user-facing failures.

## Important Design Decisions

- Fail-fast validation prevents unnecessary backend subprocess execution.
- Limits are enforced before backend invocation to bound payload size.
- Relay does not mutate repository content directly; side effects are delegated to backend CLIs under selected sandbox.
- Backend-specific behavior is isolated behind protocol adapters to keep relay logic backend-agnostic.

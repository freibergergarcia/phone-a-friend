# Relay Core

`src/relay.ts` is the backend-agnostic execution core. It validates relay inputs, resolves context, optionally captures `git diff`, builds a normalized prompt envelope, enforces size limits, applies depth guard protection, and delegates execution to a selected backend adapter. It also provides a dedicated `reviewRelay()` path for diff-scoped code review.

## Relay Processing Flow

```mermaid
flowchart TD
  A[relay called] --> B{prompt non-empty?}
  B -- no --> E1[RelayError: Prompt is required]
  B -- yes --> C{timeout > 0?}
  C -- no --> E2[RelayError: Timeout must be greater than zero]
  C -- yes --> D{repo exists and is dir?}
  D -- no --> E3[RelayError: invalid repo path]
  D -- yes --> G[getBackend backend_name]
  G --> H{backend found?}
  H -- no --> E4[RelayError: unsupported backend]
  H -- yes --> I{sandbox in backend.allowedSandboxes?}
  I -- no --> E5[RelayError: invalid sandbox]

  I -- yes --> J[resolve context]
  J --> J1{both contextFile and contextText?}
  J1 -- yes --> E6[RelayError]
  J1 -- no --> J2[read context file if provided]
  J2 --> J3[enforce 200 KB context limit]

  J3 --> K{includeDiff?}
  K -- yes --> K1["gitDiff(repoPath) — two-phase silent"]
  K1 --> K3[enforce 300 KB diff limit]
  K -- no --> L

  K3 --> L[build full prompt envelope]
  L --> M[enforce 500 KB prompt limit]
  M --> N[depth guard PHONE_A_FRIEND_DEPTH]
  N --> N1{depth >= MAX_RELAY_DEPTH?}
  N1 -- yes --> E8[RelayError: depth limit reached]
  N1 -- no --> O[set env depth+1]
  O --> P[await selectedBackend.run ...]
  P --> Q{BackendError?}
  Q -- yes --> E9[RelayError wrapping BackendError]
  Q -- no --> R{other unknown error?}
  R -- yes --> R1[re-throw raw]
  R -- no --> S[return backend feedback]
```

Note: git diff failures in `relay()` are silently swallowed by `tryGitDiff()` (returns `''`). Only size-limit violations from the diff are propagated as `RelayError`.

## Review Relay Flow

`reviewRelay()` provides diff-scoped code review. It supports a dual-path strategy: backends that implement a native `review()` method (currently only Codex) use it directly; all other backends fall back to a generic diff-based relay via `run()`.

```mermaid
flowchart TD
  A[reviewRelay called] --> B{timeout > 0?}
  B -- no --> E1[RelayError: Timeout must be greater than zero]
  B -- yes --> C{repo exists and is dir?}
  C -- no --> E2[RelayError: invalid repo path]
  C -- yes --> D[getBackend backend_name]
  D --> E{backend found?}
  E -- no --> E3[RelayError: unsupported backend]
  E -- yes --> F{sandbox valid?}
  F -- no --> E4[RelayError: invalid sandbox]
  F -- yes --> G["resolve base branch (opts.base ?? detectDefaultBranch)"]
  G --> H[depth guard: nextRelayEnv]
  H --> I{backend has review method?}

  I -- yes --> J["await backend.review(repoPath, base, ...)"]
  J --> K{success?}
  K -- yes --> Z[return review feedback]
  K -- no --> L{RelayError?}
  L -- yes --> E5[re-throw RelayError]
  L -- no --> M["log warning, fall through to generic path"]

  I -- no --> M
  M --> N["gitDiffBase(repoPath, base)"]
  N --> O{diff succeeded?}
  O -- no --> E6[RelayError: diff collection failed]
  O -- yes --> P[buildPrompt with diff + review prompt]
  P --> Q[enforce 500 KB prompt limit]
  Q --> R["await backend.run(fullPrompt, ...)"]
  R --> S{BackendError?}
  S -- yes --> E7[RelayError wrapping BackendError]
  S -- no --> T{unknown error?}
  T -- yes --> T1[re-throw raw]
  T -- no --> Z
```

### ReviewRelayOptions Interface

```typescript
interface ReviewRelayOptions {
  repoPath: string;
  backend?: string;       // default: 'codex'
  base?: string;          // default: detectDefaultBranch() → main/master/HEAD~1
  prompt?: string;        // default: 'Review the following changes.'
  timeoutSeconds?: number;
  model?: string | null;
  sandbox?: SandboxMode;
}
```

## Git Diff Functions

The relay module provides three git diff functions and a branch detection helper:

| Function | Signature | Failure Behavior |
|----------|-----------|-----------------|
| `tryGitDiff` | `(repoPath, args): string` | Silent failure — returns `''` on git errors; propagates size-limit `RelayError` |
| `gitDiff` | `(repoPath): string` | Two-phase: tries `HEAD --` first, then `HEAD~1 HEAD --` as fallback; uses `tryGitDiff` internally |
| `gitDiffBase` | `(repoPath, base): string` | Strict — throws `RelayError` on failure with stderr detail |
| `detectDefaultBranch` | `(repoPath): string` | Tries `main` → `master` → falls back to `'HEAD~1'` |

### tryGitDiff (silent failure)

```mermaid
flowchart LR
  A["tryGitDiff(repoPath, args)"] --> B["git -C repo diff ...args"]
  B --> C{succeeded?}
  C -- yes --> D[enforce 300 KB limit]
  D --> E{within limit?}
  E -- yes --> F[return diff text]
  E -- no --> G[throw RelayError: too large]
  C -- no --> H["return '' (swallow error)"]
```

### gitDiff (two-phase)

```mermaid
flowchart TD
  A["gitDiff(repoPath)"] --> B["tryGitDiff(repoPath, ['HEAD', '--'])"]
  B --> C{non-empty?}
  C -- yes --> D[return uncommitted diff]
  C -- no --> E["tryGitDiff(repoPath, ['HEAD~1', 'HEAD', '--'])"]
  E --> F[return last-commit diff or empty]
```

### gitDiffBase (strict)

```mermaid
flowchart LR
  A["gitDiffBase(repoPath, base)"] --> B["git -C repo diff base...HEAD --"]
  B --> C{succeeded?}
  C -- yes --> D[enforce 300 KB limit]
  D --> E[return diff text]
  C -- no --> F["throw RelayError with stderr detail"]
```

### detectDefaultBranch

```mermaid
flowchart LR
  A["detectDefaultBranch(repoPath)"] --> B["git rev-parse --verify main"]
  B --> C{exists?}
  C -- yes --> D["return 'main'"]
  C -- no --> E["git rev-parse --verify master"]
  E --> F{exists?}
  F -- yes --> G["return 'master'"]
  F -- no --> H["return 'HEAD~1'"]
```

## Prompt Envelope Structure

`buildPrompt(...)` constructs a consistent structure sent to every backend:

```
You are helping another coding agent by reviewing or advising on work in a local repository.
Repository path: /path/to/repo
Use the repository files for context when needed.
Respond with concise, actionable feedback.

Request:
<user prompt>

Additional Context:        (optional, if contextText provided)
<context text>

Git Diff:                  (optional, if includeDiff=true or review mode)
<diff output>
```

This normalization keeps backend prompts consistent across Codex, Gemini, and Ollama.

## Size Limit Enforcement

| Limit | Constant | Value |
|-------|----------|-------|
| Context | `MAX_CONTEXT_FILE_BYTES` | 200,000 bytes |
| Diff | `MAX_DIFF_BYTES` | 300,000 bytes |
| Final prompt | `MAX_PROMPT_BYTES` | 500,000 bytes |

Measurement uses `Buffer.byteLength(text, 'utf-8')`.

## Depth Guard Mechanism

```mermaid
sequenceDiagram
  participant Env as process.env
  participant Relay as nextRelayEnv
  participant Backend as Backend adapter

  Env->>Relay: read PHONE_A_FRIEND_DEPTH (default "0")
  Relay->>Relay: strict regex /^\d+$/ test, fallback 0 on mismatch
  alt depth >= MAX_RELAY_DEPTH (1)
    Relay-->>Env: RelayError depth limit reached
  else depth < MAX_RELAY_DEPTH
    Relay->>Relay: set env PHONE_A_FRIEND_DEPTH = depth + 1
    Relay->>Backend: await run with updated env
  end
```

- `MAX_RELAY_DEPTH = 1` means no nested relay inside an active relay execution.
- Depth parsing uses strict `^\d+$` regex — partial numeric strings like `"1abc"` are rejected and coerced to `0`.

## Key Components and Responsibilities

| Function | Role |
|----------|------|
| `resolveContextText` | Enforces mutual exclusivity of file/text context, delegates file reads |
| `readContextFile` | File existence/type/readability checks and context-size enforcement |
| `tryGitDiff` | Silent-failure git diff wrapper — returns `''` on git errors, propagates size-limit errors |
| `gitDiff` | Two-phase diff: uncommitted changes (HEAD) with fallback to last commit (HEAD~1) |
| `gitDiffBase` | Strict diff against a specified base — throws `RelayError` on failure with stderr detail |
| `detectDefaultBranch` | Probes `main` → `master` → falls back to `'HEAD~1'` |
| `buildPrompt` | Deterministic prompt assembly into envelope structure |
| `nextRelayEnv` | Recursion guard via env depth tracking (strict `^\d+$` regex) |
| `relay` | Async orchestration entry point: validation, dispatch, unified error surface |
| `reviewRelay` | Review-specific entry point: native `review()` with generic diff fallback |

## Error Handling Chain

```mermaid
classDiagram
  class Error
  class BackendError
  class RelayError
  class CodexBackendError
  class GeminiBackendError
  class OllamaBackendError

  Error <|-- BackendError
  Error <|-- RelayError
  BackendError <|-- CodexBackendError
  BackendError <|-- GeminiBackendError
  BackendError <|-- OllamaBackendError
```

- Both `relay()` and `reviewRelay()` catch `BackendError` from adapters and rethrow as `RelayError`.
- Validation, context, prompt, and depth failures raise `RelayError` directly.
- Unknown errors (not `RelayError` or `BackendError`) are re-thrown raw — they are not wrapped.
- Result: CLI sees one relay-level error type for user-facing failures.

## Important Design Decisions

- Fail-fast validation prevents unnecessary backend execution.
- Limits are enforced before backend invocation to bound payload size.
- Relay does not mutate repository content directly; side effects are delegated to backend CLIs under selected sandbox.
- Backend-specific behavior is isolated behind the `Backend` interface to keep relay logic backend-agnostic.
- All backend `run()` calls are awaited (`async/await`) — the interface is `Promise<string>`.
- Review relay uses a dual-path strategy: native `backend.review()` → generic diff fallback via `backend.run()`.
- `gitDiff()` (used by `relay()`) silently swallows git failures; `gitDiffBase()` (used by `reviewRelay()`) throws on failure — this is intentional: standard relays are best-effort for diffs, while reviews require a valid diff.

# Backend System

The backend subsystem defines a common async execution contract (`Backend` interface), a runtime registry (`registerBackend`/`getBackend`), backend availability probing (`checkBackends`), and concrete adapters for Codex CLI, Gemini CLI, and Ollama HTTP API, with a shared error surface. Codex also implements a native `review()` method for diff-scoped code review.

## Backend Type Model and Error Hierarchy

```mermaid
classDiagram
  class Backend {
    <<Interface>>
    +name: string
    +allowedSandboxes: ReadonlySet~SandboxMode~
    +run(opts): Promise~string~
    +review?(opts: ReviewOptions): Promise~string~
  }

  class BackendResult {
    +output: string
    +exitCode: number
  }

  class ReviewOptions {
    +repoPath: string
    +timeoutSeconds: number
    +sandbox: SandboxMode
    +model: string | null
    +env: Record~string, string~
    +base: string
    +prompt?: string
  }

  class CodexBackend {
    +name = "codex"
    +allowedSandboxes = read-only, workspace-write, danger-full-access
    +run(opts): Promise~string~
    +review(opts: ReviewOptions): Promise~string~
  }

  class GeminiBackend {
    +name = "gemini"
    +allowedSandboxes = read-only, workspace-write, danger-full-access
    +run(opts): Promise~string~
  }

  class OllamaBackend {
    +name = "ollama"
    +allowedSandboxes = read-only, workspace-write, danger-full-access
    +run(opts): Promise~string~
    -diagnoseAndThrow(host, err, timeout): Promise~never~
  }

  class BackendError
  class CodexBackendError
  class GeminiBackendError
  class OllamaBackendError

  Backend <|.. CodexBackend
  Backend <|.. GeminiBackend
  Backend <|.. OllamaBackend
  BackendError <|-- CodexBackendError
  BackendError <|-- GeminiBackendError
  BackendError <|-- OllamaBackendError
```

Note: `review?()` is optional on the `Backend` interface. Currently only `CodexBackend` implements it. Gemini and Ollama fall back to the generic diff relay path in `reviewRelay()`.

## Registry and Discovery Flow

```mermaid
flowchart TD
  A[relay requests backend by name] --> B[getBackend name]
  B --> C[lookup in registry Map]
  C --> D{name in registry?}
  D -- no --> E[BackendError: unsupported backend]
  D -- yes --> F[return backend adapter]

  G[Self-registration at import] --> H["each backend file calls registerBackend()"]
  H --> I["registry.set(backend.name, backend)"]

  J[CLI install/status] --> K[checkBackends]
  K --> L["iterate INSTALL_HINTS keys (sorted)"]
  L --> M["isInPath(name) via which"]
  M --> N["Record<string, boolean>"]
```

## Backend Categories

| Category | Backends | Execution Model |
|----------|----------|-----------------|
| CLI subprocess | codex, gemini | `execFileSync` with args, captures stdout or temp file |
| HTTP API | ollama | `fetch` POST to local API, JSON response parsing |

## Backend Invocation Sequences

```mermaid
sequenceDiagram
  participant Relay
  participant Adapter as Backend Adapter
  participant CLI as External CLI
  participant FS as Temp File
  participant API as Ollama HTTP API

  alt Codex backend — run()
    Relay->>Adapter: await CodexBackend.run(...)
    Adapter->>Adapter: isInPath("codex")
    Adapter->>FS: create temp directory
    Adapter->>CLI: codex exec -C repo --skip-git-repo-check --sandbox mode --output-last-message tmpfile [-m model] prompt
    CLI-->>FS: write final message file
    Adapter->>FS: read tmpfile
    alt file has content
      Adapter-->>Relay: file content
    else file empty/missing
      Adapter-->>Relay: stdout fallback
    else both empty
      Adapter-->>Relay: CodexBackendError: no feedback
    end

  else Codex backend — review()
    Relay->>Adapter: await CodexBackend.review(...)
    Adapter->>Adapter: isInPath("codex")
    Adapter->>FS: create temp directory
    Adapter->>CLI: codex exec review -C repo --base BASE --sandbox mode --output-last-message tmpfile [-m model] [prompt]
    CLI-->>FS: write final message file
    Adapter->>FS: read tmpfile
    alt file has content
      Adapter-->>Relay: file content
    else file empty/missing
      Adapter-->>Relay: stdout fallback
    else both empty
      Adapter-->>Relay: CodexBackendError: no feedback
    end

  else Gemini backend
    Relay->>Adapter: await GeminiBackend.run(...)
    Adapter->>Adapter: isInPath("gemini")
    Adapter->>CLI: gemini [--sandbox] --yolo --include-directories repo --output-format text [-m model] --prompt prompt
    Note over Adapter,CLI: subprocess cwd = repoPath
    CLI-->>Adapter: stdout text
    Adapter-->>Relay: stdout

  else Ollama backend
    Relay->>Adapter: await OllamaBackend.run(...)
    Adapter->>API: POST host/api/chat {messages, model?, stream: false}
    Note over Adapter,API: AbortController for timeout
    alt HTTP status not ok
      API-->>Adapter: HTTP error status
      Adapter-->>Relay: OllamaBackendError "HTTP status: body"
    else success with content
      API-->>Adapter: {message: {content: "..."}}
      Adapter-->>Relay: trimmed content
    else success but empty content
      API-->>Adapter: {message: {content: ""}}
      Adapter-->>Relay: OllamaBackendError "completed without producing output"
    else error field in response
      API-->>Adapter: {error: "..."}
      Adapter-->>Relay: OllamaBackendError
    else fetch fails
      Adapter->>API: GET host/api/tags (diagnostic probe)
      alt server unreachable
        Adapter-->>Relay: OllamaBackendError "not reachable"
      else server reachable but chat failed
        Adapter-->>Relay: OllamaBackendError "request failed"
      end
    else timeout (AbortError)
      Adapter-->>Relay: OllamaBackendError "timed out"
    end
  end
```

## Codex vs Gemini vs Ollama: Comparison

| Concept | Codex | Gemini | Ollama |
|---------|-------|--------|--------|
| Execution model | Subprocess | Subprocess | HTTP fetch |
| Non-interactive mode | `codex exec` | `gemini --prompt` | `POST /api/chat` |
| Review mode | `codex exec review --base BASE` | N/A (generic fallback) | N/A (generic fallback) |
| Repo context | `-C <repo>` | `--include-directories <repo>` + `cwd=repo` | N/A (prompt only) |
| Sandbox: read-only | `--sandbox read-only` | `--sandbox` (boolean on) | N/A (pure inference) |
| Sandbox: workspace-write | `--sandbox workspace-write` | `--sandbox` (boolean on) | N/A |
| Sandbox: danger-full-access | `--sandbox danger-full-access` | (omit `--sandbox`) | N/A |
| Auto-approve | N/A | `--yolo` | N/A |
| Skip repo check | `--skip-git-repo-check` (run() only) | N/A | N/A |
| Output capture | `--output-last-message <file>` | `--output-format text` (stdout) | JSON `message.content` |
| Model override | `-m <model>` | `-m <model>` | `body.model` or `OLLAMA_MODEL` env |
| Model default | CLI default | CLI default | Server default (omit field) |
| Host override | N/A | N/A | `OLLAMA_HOST` env |
| Timeout | `execFileSync` timeout | `execFileSync` timeout | `AbortController` + `setTimeout` |

## Key Components and Responsibilities

| Component | Role |
|-----------|------|
| `Backend` interface | Async adapter contract with `run()` and optional `review()` |
| `BackendResult` interface | Typed subprocess result: `{output, exitCode}` |
| `ReviewOptions` interface | Options for native review: `{repoPath, timeoutSeconds, base, sandbox, model, env, prompt?}` |
| `registerBackend()` | Self-registration called at module import |
| `getBackend(name)` | Registry lookup — throws `BackendError` if not found |
| `_resetRegistry()` | Clears registry — testing only |
| `isInPath(name)` | PATH detection via `which` — used by backends and `checkBackends` |
| `checkBackends()` | Returns `Record<string, boolean>` — keyed by backend name from `INSTALL_HINTS` |
| `INSTALL_HINTS` record | Single source for backend install guidance |
| `BackendError` base class | Shared error surface for all backends |
| `CodexBackend` | Adapter for `codex exec` with temp file output + native `review()` |
| `GeminiBackend` | Adapter for `gemini --prompt` with stdout capture |
| `OllamaBackend` | HTTP adapter for Ollama `/api/chat` with `!resp.ok` handling and diagnostics |

## Important Design Decisions

- Registry uses self-registration: each backend file calls `registerBackend()` at import time.
- `src/index.ts` imports all backend files to trigger registration before CLI runs.
- Supported backends: `codex`, `gemini`, `ollama`. No dynamic plugin loading.
- No built-in multi-backend fallback in relay core; caller decides backend strategy.
- All adapters share the same allowed sandbox value set for consistent relay validation.
- Error taxonomy: one base class (`BackendError`) plus backend-specific subclasses.
- Codex uses temp file as primary output channel with stdout fallback; Gemini captures stdout directly; Ollama parses JSON response.
- Ollama validates HTTP status (`!resp.ok`) before parsing JSON, and throws on empty content.
- Ollama uses failure-path diagnostics: only probes `/api/tags` when `/api/chat` fails, to distinguish timeout vs unreachable vs request error.
- All `run()` methods are async (`Promise<string>`) to support both subprocess and HTTP backends uniformly.
- `review()` is optional — only Codex implements it natively via `codex exec review`. Other backends fall back to `reviewRelay()`'s generic diff-based relay path.

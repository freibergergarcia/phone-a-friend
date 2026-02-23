# Backend System

The backend subsystem defines a common async execution contract (`Backend` interface), a runtime registry (`registerBackend`/`getBackend`), backend availability probing (`checkBackends`), and concrete adapters for Codex CLI, Gemini CLI, and Ollama HTTP API, with a shared error surface.

## Backend Type Model and Error Hierarchy

```mermaid
classDiagram
  class Backend {
    <<Interface>>
    +name: string
    +allowedSandboxes: ReadonlySet~SandboxMode~
    +run(opts): Promise~string~
  }

  class CodexBackend {
    +name = "codex"
    +allowedSandboxes = read-only, workspace-write, danger-full-access
    +run(opts): Promise~string~
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

## Registry and Discovery Flow

```mermaid
flowchart TD
  A[relay requests backend by name] --> B[getBackend name]
  B --> C[lookup in registry Map]
  C --> D{name in registry?}
  D -- no --> E[RelayError: unsupported backend]
  D -- yes --> F[return backend adapter]

  G[Self-registration at import] --> H["each backend file calls registerBackend()"]
  H --> I["registry.set(backend.name, backend)"]

  J[CLI install/status] --> K[checkBackends]
  K --> L["iterate INSTALL_HINTS keys"]
  L --> M["execFileSync('which', [name])"]
  M --> N["availability map: {name, available, hint}[]"]
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

  alt Codex backend
    Relay->>Adapter: await CodexBackend.run(...)
    Adapter->>Adapter: which("codex")
    Adapter->>FS: create temp directory
    Adapter->>CLI: codex exec -C repo --skip-git-repo-check --sandbox mode --output-last-message tmpfile [-m model] prompt
    CLI-->>FS: write final message file
    Adapter->>FS: read tmpfile
    alt file has content
      Adapter-->>Relay: file content
    else file empty/missing
      Adapter-->>Relay: stdout fallback
    end

  else Gemini backend
    Relay->>Adapter: await GeminiBackend.run(...)
    Adapter->>Adapter: which("gemini")
    Adapter->>CLI: gemini [--sandbox] --yolo --include-directories repo --output-format text [-m model] --prompt prompt
    Note over Adapter,CLI: subprocess cwd = repoPath
    CLI-->>Adapter: stdout text
    Adapter-->>Relay: stdout

  else Ollama backend
    Relay->>Adapter: await OllamaBackend.run(...)
    Adapter->>API: POST host/api/chat {messages, model?, stream: false}
    Note over Adapter,API: AbortController for timeout
    alt success
      API-->>Adapter: {message: {content: "..."}}
      Adapter-->>Relay: trimmed content
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
    else timeout
      Adapter-->>Relay: OllamaBackendError "timed out"
    end
  end
```

## Codex vs Gemini vs Ollama: Comparison

| Concept | Codex | Gemini | Ollama |
|---------|-------|--------|--------|
| Execution model | Subprocess | Subprocess | HTTP fetch |
| Non-interactive mode | `codex exec` | `gemini --prompt` | `POST /api/chat` |
| Repo context | `-C <repo>` | `--include-directories <repo>` + `cwd=repo` | N/A (prompt only) |
| Sandbox: read-only | `--sandbox read-only` | `--sandbox` (boolean on) | N/A (pure inference) |
| Sandbox: workspace-write | `--sandbox workspace-write` | `--sandbox` (boolean on) | N/A |
| Sandbox: danger-full-access | `--sandbox danger-full-access` | (omit `--sandbox`) | N/A |
| Auto-approve | N/A | `--yolo` | N/A |
| Output capture | `--output-last-message <file>` | `--output-format text` (stdout) | JSON `message.content` |
| Model override | `-m <model>` | `-m <model>` | `body.model` or `OLLAMA_MODEL` env |
| Model default | CLI default | CLI default | Server default (omit field) |
| Host override | N/A | N/A | `OLLAMA_HOST` env |
| Timeout | `execFileSync` timeout | `execFileSync` timeout | `AbortController` + `setTimeout` |

## Key Components and Responsibilities

| Component | Role |
|-----------|------|
| `Backend` interface | Async adapter contract used by relay core |
| `registerBackend()` | Self-registration called at module import |
| `getBackend(name)` | Registry lookup and validation |
| `INSTALL_HINTS` record | Single source for backend install guidance |
| `checkBackends()` | CLI-level PATH probing for availability |
| `BackendError` base class | Shared error surface for all backends |
| `CodexBackend` | Adapter for `codex exec` with temp file output |
| `GeminiBackend` | Adapter for `gemini --prompt` with stdout capture |
| `OllamaBackend` | HTTP adapter for Ollama `/api/chat` with diagnostics |

## Important Design Decisions

- Registry uses self-registration: each backend file calls `registerBackend()` at import time.
- `src/index.ts` imports all backend files to trigger registration before CLI runs.
- Supported backends: `codex`, `gemini`, `ollama`. No dynamic plugin loading.
- No built-in multi-backend fallback in relay core; caller decides backend strategy.
- All adapters share the same allowed sandbox value set for consistent relay validation.
- Error taxonomy: one base class (`BackendError`) plus backend-specific subclasses.
- Codex uses temp file as primary output channel with stdout fallback; Gemini captures stdout directly; Ollama parses JSON response.
- Ollama uses failure-path diagnostics: only probes `/api/tags` when `/api/chat` fails, to distinguish timeout vs unreachable vs request error.
- All `run()` methods are async (`Promise<string>`) to support both subprocess and HTTP backends uniformly.

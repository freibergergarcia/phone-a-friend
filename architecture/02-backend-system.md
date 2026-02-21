# Backend System

The backend subsystem defines a common execution contract (`RelayBackend`), runtime backend selection (`get_backend`), backend availability probing (`check_backends`), and concrete adapters for Codex and Gemini CLIs with a shared error surface.

## Backend Type Model and Error Hierarchy

```mermaid
classDiagram
  class RelayBackend {
    <<Protocol>>
    +name: str
    +allowed_sandboxes: frozenset[str]
    +run(prompt, repo_path, timeout_seconds, sandbox, model, env) str
  }

  class CodexBackend {
    +name = "codex"
    +allowed_sandboxes = read-only, workspace-write, danger-full-access
    +run(...)
  }

  class GeminiBackend {
    +name = "gemini"
    +allowed_sandboxes = read-only, workspace-write, danger-full-access
    +run(...)
  }

  class BackendError
  class CodexBackendError
  class GeminiBackendError

  RelayBackend <|.. CodexBackend
  RelayBackend <|.. GeminiBackend
  BackendError <|-- CodexBackendError
  BackendError <|-- GeminiBackendError
```

## Registry and Discovery Flow

```mermaid
flowchart TD
  A[relay requests backend by name] --> B[get_backend name]
  B --> C[import CODEX_BACKEND and GEMINI_BACKEND]
  C --> D[build registry map by backend.name]
  D --> E{name in registry?}
  E -- no --> F[ValueError unsupported backend]
  E -- yes --> G[return backend adapter]

  H[CLI install/status] --> I[check_backends]
  I --> J["iterate INSTALL_HINTS keys: codex, gemini"]
  J --> K["shutil.which(backend_name)"]
  K --> L["availability map: {name: bool}"]
```

## Backend Invocation Sequences

```mermaid
sequenceDiagram
  participant Relay
  participant Adapter as Backend Adapter
  participant CLI as External CLI
  participant FS as Temp File

  alt Codex backend
    Relay->>Adapter: CodexBackend.run(...)
    Adapter->>Adapter: shutil.which("codex")
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
    Relay->>Adapter: GeminiBackend.run(...)
    Adapter->>Adapter: shutil.which("gemini")
    Adapter->>CLI: gemini [--sandbox] --yolo --include-directories repo --output-format text [-m model] --prompt prompt
    Note over Adapter,CLI: subprocess cwd = repo_path
    CLI-->>Adapter: stdout text
    Adapter-->>Relay: stdout
  end
```

## Codex vs Gemini: CLI Flag Mapping

| Concept | Codex | Gemini |
|---------|-------|--------|
| Non-interactive mode | `codex exec` | `gemini --prompt` |
| Repo context | `-C <repo>` | `--include-directories <repo>` + `cwd=repo` |
| Sandbox: read-only | `--sandbox read-only` | `--sandbox` (boolean on) |
| Sandbox: workspace-write | `--sandbox workspace-write` | `--sandbox` (boolean on) |
| Sandbox: danger-full-access | `--sandbox danger-full-access` | (omit `--sandbox`) |
| Auto-approve | N/A | `--yolo` |
| Output capture | `--output-last-message <file>` | `--output-format text` (stdout) |
| Model override | `-m <model>` | `-m <model>` |
| Git check skip | `--skip-git-repo-check` | N/A |

## Key Components and Responsibilities

| Component | Role |
|-----------|------|
| `RelayBackend` protocol | Stable adapter contract used by relay core |
| `INSTALL_HINTS` dict | Single source for backend install guidance |
| `get_backend(name)` | Explicit registry lookup and validation |
| `check_backends()` | CLI-level PATH probing for availability |
| `BackendRegistration` dataclass | Backend metadata container (name + backend) |
| `CodexBackend` | Adapter for `codex exec` with temp file output |
| `GeminiBackend` | Adapter for `gemini --prompt` with stdout capture |

## Important Design Decisions

- Registry is explicit and code-local (no dynamic plugin loading for backends).
- Supported backend names are currently fixed to `codex` and `gemini`.
- No built-in multi-backend fallback in relay core; caller decides backend strategy.
- Both adapters share the same allowed sandbox value set for consistent relay validation.
- Error taxonomy is intentionally simple: one base class plus backend-specific subclasses.
- Codex uses temp file as primary output channel with stdout fallback; Gemini captures stdout directly.

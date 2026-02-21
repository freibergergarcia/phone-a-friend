# Installer and Plugin System

The installer subsystem wires this repository into Claude Code's plugin ecosystem and manages lifecycle operations (`install`, `update`, `uninstall`). It also optionally synchronizes plugin registration via the `claude` CLI and reports backend availability status after install.

## Install/Update/Uninstall Lifecycle

```mermaid
flowchart TD
  A[CLI command] --> B{install / update / uninstall}

  B -- install --> C[install_hosts]
  B -- update --> D["install_hosts(force=True)"]
  B -- uninstall --> E[uninstall_hosts]

  C --> C1["validate target in {claude, all}"]
  C1 --> C2["validate mode in {symlink, copy}"]
  C2 --> C3["validate repo_root has .claude-plugin/plugin.json"]
  C3 --> C4["_install_claude -> _install_path"]
  C4 --> C5{mode?}
  C5 -- symlink --> C6["symlink ~/.claude/plugins/phone-a-friend -> repo"]
  C5 -- copy --> C7["copytree repo -> ~/.claude/plugins/phone-a-friend"]
  C6 --> C8{sync_claude_cli?}
  C7 --> C8
  C8 -- yes --> C9["_sync_claude_plugin_registration"]
  C8 -- no --> C10[skip sync]
  C9 --> C11[return status lines]
  C10 --> C11

  E --> E1["_uninstall_claude -> remove target path"]
```

## Claude Plugin Registration Flow

```mermaid
sequenceDiagram
  participant CLI as phone-a-friend install
  participant Installer as installer.py
  participant ClaudeCLI as claude plugin ...
  participant PluginDir as ~/.claude/plugins/phone-a-friend

  CLI->>Installer: install_hosts(repo_root, mode, force, sync_claude_cli)
  Installer->>PluginDir: symlink or copy repository

  alt sync_claude_cli enabled and claude binary present
    Installer->>ClaudeCLI: plugin marketplace add <repo_root>
    ClaudeCLI-->>Installer: ok / already configured
    Installer->>ClaudeCLI: plugin marketplace update phone-a-friend-dev
    ClaudeCLI-->>Installer: ok / already up to date
    Installer->>ClaudeCLI: plugin install phone-a-friend@phone-a-friend-dev -s user
    ClaudeCLI-->>Installer: ok / already installed
    Installer->>ClaudeCLI: plugin enable phone-a-friend@phone-a-friend-dev -s user
    ClaudeCLI-->>Installer: ok / already enabled
    Installer->>ClaudeCLI: plugin update phone-a-friend@phone-a-friend-dev
    ClaudeCLI-->>Installer: ok / already up to date
    Installer-->>CLI: per-step ok/failed lines
  else claude binary missing
    Installer-->>CLI: "claude_cli: skipped"
  end
```

## Install Path Resolution

```mermaid
flowchart LR
  A["_install_path(src, dst, mode, force)"] --> B{dst exists?}
  B -- no --> C{mode}
  B -- yes --> D{same symlink?}
  D -- yes --> E["already-installed"]
  D -- no --> F{force?}
  F -- no --> G["RuntimeError: destination exists"]
  F -- yes --> H[remove existing]
  H --> C
  C -- symlink --> I["dst.symlink_to(src)"]
  C -- copy --> J["shutil.copytree(src, dst)"]
  I --> K["installed"]
  J --> K
```

## Key Components and Responsibilities

| Component | Role |
|-----------|------|
| `install_hosts()` | Top-level install orchestrator: validates, installs, syncs |
| `uninstall_hosts()` | Top-level uninstall: removes plugin target path |
| `_install_claude()` | Resolves target path, delegates to `_install_path` |
| `_install_path()` | Low-level symlink/copy with force and idempotency handling |
| `_sync_claude_plugin_registration()` | Runs 5 `claude plugin` commands for marketplace sync |
| `_looks_like_ok_if_already()` | Idempotency detector for "already installed" responses |
| `verify_backends()` | Reports backend CLI availability post-install |
| `_is_valid_repo_root()` | Validates `.claude-plugin/plugin.json` exists |

## Symlink vs Copy Modes

| Mode | Use Case | Behavior |
|------|----------|----------|
| `symlink` | Local development | Installed path points to live repo state; changes reflect immediately |
| `copy` | Snapshot install | Full copy into `~/.claude/plugins/`; isolated from ongoing edits |

## Marketplace Integration

The installer runs Claude CLI commands in this fixed sequence:

1. `claude plugin marketplace add <repo_root>` -- register source
2. `claude plugin marketplace update phone-a-friend-dev` -- refresh index
3. `claude plugin install phone-a-friend@phone-a-friend-dev -s user` -- install package
4. `claude plugin enable phone-a-friend@phone-a-friend-dev -s user` -- activate
5. `claude plugin update phone-a-friend@phone-a-friend-dev` -- pull latest

"Already installed/configured/up to date" responses are treated as successful idempotent completions.

Constants:
- `PLUGIN_NAME = "phone-a-friend"`
- `MARKETPLACE_NAME = "phone-a-friend-dev"`

## Backend Availability Verification

```mermaid
flowchart LR
  A[verify_backends] --> B[check_backends]
  B --> C["shutil.which('codex')"]
  B --> D["shutil.which('gemini')"]
  C --> E["{name, available, hint}"]
  D --> E
  E --> F[Display to user after install]
```

## Important Design Decisions

- Repo-root validity gate requires `.claude-plugin/plugin.json`.
- Install target scope is currently Claude-only (`claude`/`all` aliases).
- Installer is idempotence-aware for "already" states from Claude CLI.
- Backend checks are advisory; installation does not fail due to missing backend CLIs.
- CI/release enforce version sync between `pyproject.toml` and `.claude-plugin/plugin.json`.

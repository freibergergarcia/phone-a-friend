# Installer and Plugin System

The installer subsystem wires this repository into Claude Code's plugin ecosystem and manages lifecycle operations (`install`, `update`, `uninstall`). It also optionally synchronizes plugin registration via the `claude` CLI and reports backend availability status after install.

## Install/Update/Uninstall Lifecycle

```mermaid
flowchart TD
  A[CLI command] --> B{install / update / uninstall}

  B -- install --> C[installHosts]
  B -- update --> D["installHosts(force=true)"]
  B -- uninstall --> E[uninstallHosts]

  C --> C1["validate target in {claude, all}"]
  C1 --> C2["validate mode in {symlink, copy}"]
  C2 --> C3["validate repoRoot has .claude-plugin/plugin.json"]
  C3 --> C4["installClaude -> installPath"]
  C4 --> C5{mode?}
  C5 -- symlink --> C6["symlink ~/.claude/plugins/phone-a-friend -> repo"]
  C5 -- copy --> C7["cpSync repo -> ~/.claude/plugins/phone-a-friend"]
  C6 --> C8{syncClaudeCli?}
  C7 --> C8
  C8 -- yes --> C9["syncClaudePluginRegistration (5 commands)"]
  C8 -- no --> C10[skip sync]
  C9 --> C11[return status lines]
  C10 --> C11

  E --> E1["uninstallClaude — remove target path FIRST"]
  E1 --> E2["unsyncClaudePluginRegistration — then deregister from CLI"]
```

## Claude Plugin Registration Flow

```mermaid
sequenceDiagram
  participant CLI as phone-a-friend install
  participant Installer as installer.ts
  participant ClaudeCLI as claude plugin ...
  participant PluginDir as ~/.claude/plugins/phone-a-friend

  CLI->>Installer: installHosts(repoRoot, mode, force, syncClaudeCli)
  Installer->>PluginDir: symlink or copy repository

  alt syncClaudeCli enabled and claude binary present
    Installer->>ClaudeCLI: plugin marketplace add <repoRoot>
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

## Uninstall Flow

Uninstall removes the plugin files first, then deregisters from the Claude CLI plugin registry:

```mermaid
sequenceDiagram
  participant CLI as phone-a-friend uninstall
  participant Installer as installer.ts
  participant FS as ~/.claude/plugins/phone-a-friend
  participant ClaudeCLI as claude plugin ...

  CLI->>Installer: uninstallHosts(target)
  Installer->>FS: uninstallClaude — remove symlink/directory
  FS-->>Installer: removed / not-installed

  alt claude binary present
    Installer->>ClaudeCLI: plugin disable phone-a-friend@phone-a-friend-dev -s user
    ClaudeCLI-->>Installer: ok / failed
    Installer->>ClaudeCLI: plugin uninstall phone-a-friend@phone-a-friend-dev -s user
    ClaudeCLI-->>Installer: ok / failed
  else claude binary missing
    Installer-->>CLI: "claude_cli: skipped"
  end
  Installer-->>CLI: status lines
```

## Install Path Resolution

```mermaid
flowchart LR
  A["installPath(src, dst, mode, force)"] --> B{dst exists?}
  B -- no --> C{mode}
  B -- yes --> D{same symlink?}
  D -- yes --> E["already-installed"]
  D -- no --> F{force?}
  F -- no --> G["InstallerError: destination exists"]
  F -- yes --> H[remove existing]
  H --> C
  C -- symlink --> I["fs.symlinkSync(src, dst)"]
  C -- copy --> J["fs.cpSync(src, dst, {recursive})"]
  I --> K["installed"]
  J --> K
```

## Plugin Status Detection

`isPluginInstalled()` checks whether the Claude plugin is installed:
- Resolves `claudeTarget()` path (`~/.claude/plugins/phone-a-friend`)
- For symlinks: checks `lstatSync` reports symlink AND `existsSync` returns true (not dangling)
- For copies/directories: checks `existsSync` returns true
- Both paths use the same underlying `existsSync()` call — the symlink branch adds a dangling-link check
- Used by TUI's `PluginStatusBar` component for live status display

## Key Components and Responsibilities

| Component | Role |
|-----------|------|
| `installHosts()` | Top-level install orchestrator: validates, installs, optionally syncs CLI |
| `uninstallHosts()` | Top-level uninstall: removes plugin files FIRST, then deregisters from Claude CLI |
| `installClaude()` | Resolves target path, delegates to `installPath` |
| `installPath()` | Low-level symlink/copy with force and idempotency handling |
| `syncClaudePluginRegistration()` | Runs 5 `claude plugin` commands for marketplace sync (install flow) |
| `unsyncClaudePluginRegistration()` | Runs `disable` then `uninstall` commands (uninstall flow) |
| `looksLikeOkIfAlready()` | Idempotency detector for "already installed" responses |
| `verifyBackends()` | Calls `checkBackends()` and maps to `BackendInfo[]` for display |
| `checkBackends()` | Returns `Record<string, boolean>` — raw availability map from backend registry |
| `isValidRepoRoot()` | Validates `.claude-plugin/plugin.json` exists |
| `isPluginInstalled()` | Checks if Claude plugin symlink/copy exists (used by TUI) |
| `claudeTarget()` | Resolves `~/.claude/plugins/phone-a-friend` path |

## Symlink vs Copy Modes

| Mode | Use Case | Behavior |
|------|----------|----------|
| `symlink` | Local development | Installed path points to live repo state; changes reflect immediately |
| `copy` | Snapshot install | Full copy into `~/.claude/plugins/`; isolated from ongoing edits |

## Marketplace Integration

The installer runs Claude CLI commands in this fixed sequence:

1. `claude plugin marketplace add <repoRoot>` -- register source
2. `claude plugin marketplace update phone-a-friend-dev` -- refresh index
3. `claude plugin install phone-a-friend@phone-a-friend-dev -s user` -- install package
4. `claude plugin enable phone-a-friend@phone-a-friend-dev -s user` -- activate
5. `claude plugin update phone-a-friend@phone-a-friend-dev` -- pull latest

"Already installed/configured/up to date" responses are treated as successful idempotent completions.

Constants:
- `PLUGIN_NAME = "phone-a-friend"`
- `MARKETPLACE_NAME = "phone-a-friend-dev"`

## Backend Availability Verification

After install, `verifyBackends()` reports which backend CLIs are available:

```mermaid
flowchart LR
  A["verifyBackends()"] --> B["checkBackends()"]
  B --> C["Record<string, boolean> (keyed by INSTALL_HINTS)"]
  C --> D["map to BackendInfo[] {name, available, hint}"]
  D --> E[Display to user after install]
```

Note: `checkBackends()` (in `src/backends/index.ts`) returns `Record<string, boolean>`. `verifyBackends()` (in `src/installer.ts`) wraps this into `BackendInfo[]` with install hints for display purposes.

## Important Design Decisions

- Repo-root validity gate requires `.claude-plugin/plugin.json`.
- Install target scope is currently Claude-only (`claude`/`all` aliases).
- Installer is idempotence-aware for "already" states from Claude CLI.
- Backend checks are advisory; installation does not fail due to missing backend CLIs.
- CI/release enforce version sync between `package.json` and `.claude-plugin/plugin.json`.
- Uninstall removes plugin files first, then deregisters from Claude CLI — this order ensures the plugin directory is cleaned up even if CLI deregistration fails.
- `isPluginInstalled()` enables TUI to show real-time plugin status.

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
  C8 -- yes --> C9["syncClaudePluginRegistration"]
  C8 -- no --> C10[skip sync]
  C9 --> C11[return status lines]
  C10 --> C11

  E --> E1["uninstallClaude -> deregister + remove target path"]
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
- For symlinks: checks exists + valid target (not dangling)
- For copies: checks directory exists
- Used by TUI's `PluginStatusBar` component for live status display

## Key Components and Responsibilities

| Component | Role |
|-----------|------|
| `installHosts()` | Top-level install orchestrator: validates, installs, syncs |
| `uninstallHosts()` | Top-level uninstall: deregisters from Claude CLI, removes target path |
| `installClaude()` | Resolves target path, delegates to `installPath` |
| `installPath()` | Low-level symlink/copy with force and idempotency handling |
| `syncClaudePluginRegistration()` | Runs 5 `claude plugin` commands for marketplace sync |
| `looksLikeOkIfAlready()` | Idempotency detector for "already installed" responses |
| `verifyBackends()` | Reports backend CLI availability post-install |
| `isValidRepoRoot()` | Validates `.claude-plugin/plugin.json` exists |
| `isPluginInstalled()` | Checks if Claude plugin symlink/copy exists |
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

```mermaid
flowchart LR
  A[verifyBackends] --> B[checkBackends]
  B --> C["execFileSync('which', ['codex'])"]
  B --> D["execFileSync('which', ['gemini'])"]
  C --> E["{name, available, hint}[]"]
  D --> E
  E --> F[Display to user after install]
```

## Important Design Decisions

- Repo-root validity gate requires `.claude-plugin/plugin.json`.
- Install target scope is currently Claude-only (`claude`/`all` aliases).
- Installer is idempotence-aware for "already" states from Claude CLI.
- Backend checks are advisory; installation does not fail due to missing backend CLIs.
- CI/release enforce version sync between `package.json` and `.claude-plugin/plugin.json`.
- Uninstall now deregisters from Claude CLI plugin registry before removing files.
- `isPluginInstalled()` enables TUI to show real-time plugin status.

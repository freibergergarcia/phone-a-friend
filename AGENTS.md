# AGENTS.md

Guidance for AI coding agents working in `phone-a-friend`.

## What This Is

`phone-a-friend` is a TypeScript CLI for relaying prompts + repository context to coding backends (Codex, Gemini).

## Project Structure

```
src/
  index.ts           Entry point — imports backends, runs CLI
  cli.ts             Commander.js CLI with subcommands
  relay.ts           Backend-agnostic relay core
  context.ts         RelayContext interface
  installer.ts       Claude plugin installer (symlink/copy)
  backends/
    index.ts         Backend interface, registry, types
    codex.ts         Codex subprocess backend
    gemini.ts        Gemini subprocess backend
tests/               Vitest tests (mirrors src/ structure)
dist/                Built bundle (committed, self-contained)
```

## Core Behavior

- Relay core is backend-agnostic in `src/relay.ts`
- Backend interface/registry in `src/backends/index.ts`
- Codex backend in `src/backends/codex.ts`
- Gemini backend in `src/backends/gemini.ts`
- Depth guard env var: `PHONE_A_FRIEND_DEPTH`
- Default sandbox: `read-only`

## CLI Contract

```bash
./phone-a-friend --to codex --repo <path> --prompt "..."
./phone-a-friend --to gemini --repo <path> --prompt "..." --model gemini-2.5-flash
```

Claude install commands:

```bash
./phone-a-friend install --claude
./phone-a-friend update
./phone-a-friend uninstall --claude
```

## Running Tests

```bash
npm test                  # vitest run
npm run typecheck         # tsc --noEmit
npm run build             # tsup (rebuilds dist/)
```

## Versioning

- Source of truth: `version` in `package.json`
- Must keep in sync: `.claude-plugin/plugin.json` `version` field (CI enforces this)
- Runtime access: reads `package.json` at startup
- CLI: `./phone-a-friend --version`
- **Auto-release**: merging to `main` with a new version automatically creates a git tag and GitHub Release
- To release: bump version in both `package.json` and `.claude-plugin/plugin.json`, merge to `main`

### When to bump

**Every PR must bump the version.** Update both `package.json` and `.claude-plugin/plugin.json` before merging.

- **Patch** (`1.0.0` → `1.0.1`): bug fixes, docs, CI changes, refactoring
- **Minor** (`1.0.0` → `1.1.0`): new features, new CLI flags, new backends
- **Major** (`1.0.0` → `2.0.0`): breaking changes to CLI contract or relay API

## Build

`dist/` is committed to git for symlink plugin installs. It must stay self-contained (runs without `node_modules/`). CI verifies this.

After changing source: `npm run build && git add dist/`

## Scope

This repository contains relay functionality and Claude plugin installer. Policy engines, hooks, approvals, and trusted scripts are intentionally out of scope.

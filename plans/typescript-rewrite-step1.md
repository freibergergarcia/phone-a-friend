# TypeScript Rewrite Execution Plan — Step 1 — COMPLETE

**Goal:** Execute the Python-to-TypeScript rewrite of phone-a-friend (defined in `plans/evolution-standalone-cli.md`) with zero downtime for the live Claude plugin.

**Status:** All 12 tasks complete. Branch: `feature/typescript-rewrite`. Python source removed. 228 tests passing. Step 2 (CLI UX) also complete on the same branch.

**Tech Stack:** TypeScript, Node.js >= 20.12, Commander.js, tsup (build), vitest (test), Ink/React (TUI)

---

## Context

phone-a-friend is a Python CLI (v0.4.4, ~970 lines, 7 files) that works as a Claude Code plugin. The evolution plan (`plans/evolution-standalone-cli.md`) defines a 9-step rewrite to TypeScript. This execution plan covers **Step 1 only** — the TypeScript port that establishes the foundation for all subsequent steps.

### Why this execution order matters

The tool is a live Claude plugin installed via symlink to the repo root. The `commands/*.md` files invoke `./phone-a-friend` (a bash wrapper). Changing the wrapper is the atomic moment where Python becomes Node. Everything before that commit is additive and risk-free. Everything after relies on `dist/index.js` existing.

### Decisions made

| Decision | Choice | Why |
|----------|--------|-----|
| Branch strategy | Single feature branch, one PR | Rewrite is atomic — no sensible intermediate merge point |
| File layout | TS at root level alongside Python | Natural positions, no collisions, no rename dance |
| CI during PR | Both Python + Node jobs | Proves nothing breaks; Python CI drops on merge |
| `dist/` in git | Yes, committed & self-contained | Symlink plugin needs it; tsup bundles deps; CI verifies freshness |
| Version sync | Triple sync during transition | `pyproject.toml` + `package.json` + `plugin.json` must match until Python removed |
| Subprocess calls | `execFile` with arg arrays only | Never shell strings — safe for paths with spaces (Codex review) |
| Python removal | Deferred to Step 6 | Reference spec during Steps 2-5 |

---

## Current state inventory

**Python source** (`phone_a_friend/`, 7 files, ~970 lines):
- `__init__.py` (20 lines) — version via importlib.metadata
- `cli.py` (436 lines) — dual Typer/argparse, subcommands: relay/install/update/uninstall
- `relay.py` (177 lines) — backend-agnostic relay, size limits, depth guard, prompt building
- `installer.py` (203 lines) — symlink/copy to `~/.claude/plugins/`, Claude CLI sync
- `backends/__init__.py` (63 lines) — Backend protocol, registry, PATH checks
- `backends/codex.py` (97 lines) — Codex subprocess backend
- `backends/gemini.py` (90 lines) — Gemini subprocess backend

**Python tests** (`tests/`, 4 files, ~968 lines):
- `test_cli.py` (334 lines), `test_relay.py` (346 lines), `test_installer.py` (120 lines), `test_gemini_backend.py` (168 lines)

**Entry point**: `./phone-a-friend` bash wrapper -> `python3 -m phone_a_friend.cli`

**Plugin infra** (unchanged through transition):
- `.claude-plugin/plugin.json` — version must sync
- `commands/phone-a-friend.md` — uses `./phone-a-friend`
- `commands/phone-a-team.md` — uses `./phone-a-friend`

**CI/CD**:
- `ci.yml` — Python 3.10/3.12/3.13, unittest, version sync (pyproject.toml <-> plugin.json)
- `release.yml` — reads pyproject.toml version, creates tag + GitHub Release
- `pages.yml` — deploys website/ (no language dependency)

---

## Task 1: Create feature branch and TS project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

**Step 1: Create feature branch**

```bash
git checkout main && git pull
git checkout -b feature/typescript-rewrite
```

**Step 2: Create `package.json`**

```json
{
  "name": "phone-a-friend",
  "version": "1.0.0-alpha.1",
  "description": "CLI relay that lets AI coding agents collaborate",
  "type": "module",
  "bin": { "phone-a-friend": "dist/index.js" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "test": "vitest run",
    "dev": "tsup src/index.ts --format esm --watch"
  },
  "files": ["dist/", ".claude-plugin/", "commands/", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "license": "MIT",
  "author": "Bruno Freiberger",
  "dependencies": {
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 5: Update `.gitignore`**

Add to existing `.gitignore`:
```
node_modules/
*.tsbuildinfo
```

Note: Do NOT add `dist/` — it must be committed for symlink plugin installs.

**Step 6: Install deps and verify**

```bash
npm install
```

Note: skip `tsc --noEmit` here — with no `src/*.ts` files yet, tsc errors with TS18003 "No inputs found". TypeScript config validation happens naturally when first source file is added in Task 2.

**Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore package-lock.json
git commit -m "chore: add TypeScript project scaffolding"
```

---

## Task 2: Port backend types and registry (`src/backends/index.ts`)

**Files:**
- Create: `src/backends/index.ts`
- Reference: `phone_a_friend/backends/__init__.py`
- Test: `tests/backends/index.test.ts`

**Step 1: Write the failing test**

Create `tests/backends/index.test.ts` — tests for:
- `getBackend()` returns registered backends by name
- `getBackend()` throws for unknown backend names
- `checkBackends()` returns availability map
- `INSTALL_HINTS` contains entries for all backends

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/backends/index.test.ts
```
Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

Port from `phone_a_friend/backends/__init__.py` (63 lines):
- `Backend` interface (replaces Python Protocol)
- `BackendResult` type
- Backend registry with `registerBackend()` / `getBackend()`
- `checkBackends()` — uses `which` for PATH detection
- `INSTALL_HINTS` map
- Export all backend names as constants

Key translation: Python `shutil.which()` -> Node `child_process.execFileSync('which', [name])` (or a small helper)

**Important (from review):** ALL subprocess calls must use `execFile`/`execFileSync` with argument arrays, never shell strings. This prevents path injection and handles paths with spaces correctly. Applies to `git`, `codex`, `gemini`, `claude`, and `which` calls throughout.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/backends/index.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/index.ts tests/backends/index.test.ts
git commit -m "feat: port backend registry and types to TypeScript"
```

---

## Task 3: Port Codex backend (`src/backends/codex.ts`)

**Files:**
- Create: `src/backends/codex.ts`
- Reference: `phone_a_friend/backends/codex.py` (97 lines)
- Test: `tests/backends/codex.test.ts`
- Reference test: `tests/test_cli.py` (Codex-related test cases)

**Step 1: Write the failing test**

Create `tests/backends/codex.test.ts` — tests for:
- Builds correct `codex exec` args
- Passes `--sandbox`, `--output-last-message`, `--skip-git-repo-check`
- Passes `--model` when provided
- Reads result from temp output file
- Handles timeout
- Handles codex not found in PATH

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/backends/codex.test.ts
```

**Step 3: Write minimal implementation**

Port from `phone_a_friend/backends/codex.py`:
- `execFile('codex', ['exec', '-C', repoPath, ...])` with temp file for output
- Same args: `--skip-git-repo-check`, `--sandbox`, `--output-last-message`, optional `--model`
- Read temp file, clean up, return result

Key translation: Python `subprocess.run()` -> Node `child_process.execFile()` wrapped in a Promise

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/backends/codex.test.ts
```

**Step 5: Commit**

```bash
git add src/backends/codex.ts tests/backends/codex.test.ts
git commit -m "feat: port Codex subprocess backend to TypeScript"
```

---

## Task 4: Port Gemini backend (`src/backends/gemini.ts`)

**Files:**
- Create: `src/backends/gemini.ts`
- Reference: `phone_a_friend/backends/gemini.py` (90 lines)
- Test: `tests/backends/gemini.test.ts`
- Reference test: `tests/test_gemini_backend.py` (168 lines)

**Step 1: Write the failing test**

Create `tests/backends/gemini.test.ts` — port all 168 lines of Python Gemini tests:
- Builds correct `gemini` CLI args
- Handles `--model` override
- Model priority/fallback logic
- `--yolo` flag always passed
- Reads stdout as result
- Handles timeout and gemini not found

**Step 2: Run test -> Step 3: Implement -> Step 4: Run test**

Same TDD cycle. Port from `phone_a_friend/backends/gemini.py`.

Key translation: Same subprocess pattern as Codex but reads stdout directly instead of temp file.

**Step 5: Commit**

```bash
git add src/backends/gemini.ts tests/backends/gemini.test.ts
git commit -m "feat: port Gemini subprocess backend to TypeScript"
```

---

## Task 5: Port RelayContext and relay core (`src/context.ts`, `src/relay.ts`)

**Files:**
- Create: `src/context.ts`
- Create: `src/relay.ts`
- Reference: `phone_a_friend/relay.py` (177 lines)
- Test: `tests/relay.test.ts`
- Reference test: `tests/test_relay.py` (346 lines)

**Step 1: Write the failing test**

Create `tests/relay.test.ts` — port all Python relay tests (346 lines):
- Size guard enforcement (context 200KB, diff 300KB, prompt 500KB)
- Depth guard (`PHONE_A_FRIEND_DEPTH` env var, max depth 1)
- Prompt building with context file / context text
- Git diff inclusion (`--include-diff`)
- Backend dispatch (calls registered backend with correct args)
- Error handling for unknown backends
- Context file reading
- Mutually exclusive `--context-file` / `--context-text`

**Step 2: Write `src/context.ts`**

```typescript
export interface RelayContext {
  backend: string;
  model: string | null;
  sandbox: string;
  timeout: number;
  repoPath: string;
  includeDiff: boolean;
  prompt: string;
  contextFile: string | null;
  contextText: string | null;
  env: Record<string, string>;
}
```

**Step 3: Write `src/relay.ts`**

Port from `phone_a_friend/relay.py` (177 lines):
- `relay()` function — builds prompt, checks size limits, calls backend
- Size constants: `MAX_CONTEXT_SIZE`, `MAX_DIFF_SIZE`, `MAX_PROMPT_SIZE`
- `_build_prompt()` equivalent — combine prompt + context + diff
- Depth guard: read/increment `PHONE_A_FRIEND_DEPTH`
- `execFileSync('git', ['-C', repoPath, 'diff', '--'])` for `--include-diff` (arg array, not shell string)
- `fs.readFileSync()` for `--context-file`

**Step 4: Run tests**

```bash
npx vitest run tests/relay.test.ts
```

**Step 5: Commit**

```bash
git add src/context.ts src/relay.ts tests/relay.test.ts
git commit -m "feat: port relay core and RelayContext to TypeScript"
```

---

## Task 6: Port installer (`src/installer.ts`)

**Files:**
- Create: `src/installer.ts`
- Reference: `phone_a_friend/installer.py` (203 lines)
- Test: `tests/installer.test.ts`
- Reference test: `tests/test_installer.py` (120 lines)

**Step 1: Write the failing test**

Create `tests/installer.test.ts` — port Python installer tests:
- Symlink creation to `~/.claude/plugins/phone-a-friend`
- Copy mode
- Already-installed detection (same symlink target)
- Force-replace behavior
- Claude CLI sync (5 commands: marketplace add/update, install, enable, update)
- Uninstall removes symlink/directory
- Repo root validation (checks `.claude-plugin/plugin.json` exists)

**Step 2: Implement**

Port from `phone_a_friend/installer.py`:
- `fs.symlinkSync()` / `fs.cpSync()` for install modes
- `child_process.execFileSync('claude', [...])` for CLI sync
- Same 5-step registration: marketplace add -> marketplace update -> install -> enable -> update

**Step 3-5: Test and commit**

```bash
git add src/installer.ts tests/installer.test.ts
git commit -m "feat: port Claude plugin installer to TypeScript"
```

---

## Task 7: Port CLI (`src/cli.ts`, `src/index.ts`)

**Files:**
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Reference: `phone_a_friend/cli.py` (436 lines)
- Test: `tests/cli.test.ts`
- Reference test: `tests/test_cli.py` (334 lines)

**Step 1: Write the failing test**

Create `tests/cli.test.ts` — port all CLI test cases:
- `--version` prints version
- `--to codex --prompt "..." --repo .` dispatches to relay
- `--to gemini` dispatches to relay
- Bare flags (`--prompt "..."` without subcommand) auto-route to relay (backward compat)
- `install --claude` calls installer
- `update` calls installer with force
- `uninstall --claude` calls uninstaller
- All flags: `--context-file`, `--context-text`, `--include-diff`, `--timeout`, `--model`, `--sandbox`
- Mutual exclusion: `--context-file` and `--context-text`
- Error cases: missing `--prompt`, unknown backend

**Step 2: Write `src/cli.ts`**

Commander.js replaces dual Typer/argparse. Key changes:
- One framework instead of two (no fallback needed)
- Subcommands: relay (default), plugin install/update/uninstall
- `_normalize_argv` equivalent: if first arg starts with `-`, treat as relay subcommand
- Version from `package.json`

The plan evolves the command tree (install -> plugin install), but Step 1 maintains exact backward compatibility:
- `phone-a-friend --to codex --prompt "..."` works (relay)
- `phone-a-friend install --claude` works
- `phone-a-friend update` works
- `phone-a-friend uninstall --claude` works

**Step 3: Write `src/index.ts`**

```typescript
#!/usr/bin/env node
import { run } from './cli.js';
run(process.argv.slice(2));
```

**Step 4: Build and test**

```bash
npm run build
npx vitest run tests/cli.test.ts
node dist/index.js --version  # should print 1.0.0-alpha.1
```

**Step 5: Commit**

```bash
git add src/cli.ts src/index.ts tests/cli.test.ts
git commit -m "feat: port CLI to Commander.js"
```

---

## Task 8: Build, verify parity, commit `dist/`

**Files:**
- Create: `dist/index.js` (built output, committed)

**Step 1: Full build**

```bash
npm run build
```

**Step 2: Run all TS tests**

```bash
npm test
```
Expected: All tests pass.

**Step 3: Verify CLI parity with Python (thorough)**

Run systematic comparison — not just happy path, also error cases and exit codes (Gemini review):
```bash
# Version output
python3 -m phone_a_friend.cli --version
node dist/index.js --version

# Help output (compare flag names, descriptions)
python3 -m phone_a_friend.cli --help
node dist/index.js --help

# Error: missing --prompt (compare exit code and error message)
python3 -m phone_a_friend.cli --to codex 2>&1; echo "exit: $?"
node dist/index.js --to codex 2>&1; echo "exit: $?"

# Error: unknown backend
python3 -m phone_a_friend.cli --to nonexistent --prompt "x" 2>&1; echo "exit: $?"
node dist/index.js --to nonexistent --prompt "x" 2>&1; echo "exit: $?"

# Error: context-file + context-text mutual exclusion
python3 -m phone_a_friend.cli --to codex --prompt "x" --context-file a --context-text b 2>&1; echo "exit: $?"
node dist/index.js --to codex --prompt "x" --context-file a --context-text b 2>&1; echo "exit: $?"

# Happy path relay (if backend available)
python3 -m phone_a_friend.cli --to codex --repo . --prompt "Hello" 2>&1 | head -10
node dist/index.js --to codex --repo . --prompt "Hello" 2>&1 | head -10
```

Key parity checks: exit codes match, error messages are semantically equivalent (exact wording may differ due to Commander.js vs argparse), all flags accepted.

**Step 4: Commit dist/**

```bash
git add dist/
git commit -m "chore: add built dist/ for symlink plugin installs"
```

---

## Task 9: Switch the bash wrapper (THE atomic moment)

**Files:**
- Modify: `phone-a-friend` (bash wrapper at repo root)

**Step 1: Replace wrapper content**

Change from Python invocation:
```bash
#!/usr/bin/env bash
set -euo pipefail
...
exec python3 -m phone_a_friend.cli "$@"
```

To Node invocation:
```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js >= 18 is required. Install: https://nodejs.org/" >&2
  exit 1
fi
# Check Node.js version >= 18 (Gemini review)
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  echo "Error: Node.js >= 18 required (found v$(node -v)). Update: https://nodejs.org/" >&2
  exit 1
fi
# Guard against missing dist/ (Codex review)
if [ ! -f "${SCRIPT_DIR}/dist/index.js" ]; then
  echo "Error: dist/index.js not found. Run 'npm run build' in ${SCRIPT_DIR}" >&2
  exit 1
fi
exec node "${SCRIPT_DIR}/dist/index.js" "$@"
```

**Step 2: Test the switch**

```bash
./phone-a-friend --version           # Should print 1.0.0-alpha.1
./phone-a-friend --to codex --repo . --prompt "Hello"  # Should relay to codex
```

**Step 3: Test plugin commands work**

If Claude Code is available, test that `/phone-a-friend` and `/phone-a-team` still work via the symlink.

**Step 4: Commit**

```bash
git add phone-a-friend
git commit -m "feat: switch CLI entry point from Python to Node.js"
```

---

## Task 10: Update CI/CD workflows

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.claude-plugin/plugin.json` (version bump)

**Step 1: Update `ci.yml`**

Replace Python CI with Node CI. Keep Python job alongside for the transition PR:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-node:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ["18", "20", "22"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - name: Check version sync (triple during transition)
        run: |
          pkg_ver=$(node -e "console.log(require('./package.json').version)")
          plugin_ver=$(node -e "console.log(require('./.claude-plugin/plugin.json').version)")
          if [ "$pkg_ver" != "$plugin_ver" ]; then
            echo "::error::Version mismatch: package.json=$pkg_ver plugin.json=$plugin_ver"
            exit 1
          fi
          # Triple sync: also check pyproject.toml during transition (remove after Step 6)
          if [ -f pyproject.toml ]; then
            py_ver=$(python3 -c "import re; print(re.search(r'^version\s*=\"([^\"]+)\"', open('pyproject.toml').read(), re.M).group(1))" 2>/dev/null || echo "skip")
            if [ "$py_ver" != "skip" ] && [ "$py_ver" != "$pkg_ver" ]; then
              echo "::error::Version mismatch: pyproject.toml=$py_ver package.json=$pkg_ver"
              exit 1
            fi
          fi
      - name: Check dist is up to date
        run: |
          npm run build
          if ! git diff --quiet dist/; then
            echo "::error::dist/ is out of date — run 'npm run build' and commit"
            exit 1
          fi
      - name: Verify dist is self-contained (no node_modules needed)
        run: |
          # Move node_modules aside, verify dist/index.js runs standalone
          mv node_modules node_modules_bak
          node dist/index.js --version
          mv node_modules_bak node_modules
      - run: npm test

  tests:
    needs: [test-node]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Check test results
        run: |
          if [ "${{ needs.test-node.result }}" != "success" ]; then
            exit 1
          fi
```

**Step 2: Update `release.yml`**

Switch version reading from pyproject.toml to package.json:
- `node -e "console.log(require('./package.json').version)"` instead of Python tomllib
- Version sync check: package.json <-> plugin.json
- Add `npm ci && npm run build && npm test` before tagging
- Add `prerelease: ${{ contains(steps.version.outputs.version, '-') }}` to gh-release step

**Step 3: Bump versions (triple sync)**

- `.claude-plugin/plugin.json`: change `"0.4.4"` -> `"1.0.0-alpha.1"`
- `pyproject.toml`: change `"0.4.4"` -> `"1.0.0-alpha.1"` (triple sync during transition)

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml .claude-plugin/plugin.json pyproject.toml
git commit -m "chore: update CI/CD for TypeScript, bump to 1.0.0-alpha.1"
```

---

## Task 11: Update project docs

**Files:**
- Modify: `CLAUDE.md` (AGENTS.md)
- Modify: `README.md` (brief note about TS rewrite)

**Step 1: Update CLAUDE.md**

Change test command:
```
## Running Tests
npm test
```

Update CLI contract section to note TypeScript. Update version sync to reference `package.json`.

**Step 2: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update project docs for TypeScript rewrite"
```

---

## Task 12: Open PR and verify

**Step 1: Push and open PR**

```bash
git push -u origin feature/typescript-rewrite
gh pr create --title "TypeScript rewrite — Step 1 port" --body "..."
```

**Step 2: Verify CI passes**

- Node 18/20/22 tests all green
- Version sync check passes (package.json `1.0.0-alpha.1` == plugin.json `1.0.0-alpha.1`)
- `dist/` up-to-date check passes

**Step 3: Manual verification checklist**

- [ ] `./phone-a-friend --version` -> `1.0.0-alpha.1`
- [ ] `./phone-a-friend --to codex --repo . --prompt "Hello"` -> relay works
- [ ] `./phone-a-friend --to gemini --repo . --prompt "Hello" --model gemini-2.5-flash` -> relay works
- [ ] `./phone-a-friend install --claude` -> plugin installs
- [ ] `/phone-a-friend` slash command works in Claude Code
- [ ] `/phone-a-team` slash command works in Claude Code
- [ ] All CLI flags work: `--context-file`, `--context-text`, `--include-diff`, `--timeout`, `--model`, `--sandbox`

**Step 4: Merge**

Squash merge to main. GitHub Release `v1.0.0-alpha.1` should be created automatically.

---

## Verification

After merge to main:

1. **CLI**: `./phone-a-friend --version` prints `1.0.0-alpha.1`
2. **Relay**: `./phone-a-friend --to codex --repo . --prompt "Hello"` works
3. **Plugin**: `/phone-a-friend` and `/phone-a-team` work in Claude Code
4. **CI**: GitHub Actions green on main
5. **Release**: `v1.0.0-alpha.1` tag and GitHub Release exist
6. **Python ref**: `phone_a_friend/` directory still exists (untouched, inert)

---

## What comes next (Steps 2-9)

After this PR merges, each subsequent step is standard feature development on the TS codebase:

| Step | Branch | What it adds |
|------|--------|-------------|
| 2 | `feature/cli-ux` | setup wizard, doctor, detection, config (Inquirer.js, chalk, ora, smol-toml) |
| 3 | `feature/ollama-backend` | Ollama HTTP backend |
| 4 | `feature/openai-backend` | OpenAI API backend |
| 5 | `feature/api-backends` | Google + Anthropic API backends |
| 6 | `feature/cleanup` | Remove Python source, update all docs |
| 7 | `feature/ollama-tools` | Read-only tool-calling agent loop |
| 8 | `feature/mutating-tools` | Write + shell tools |
| 9 | `feature/polish` | Auto-backend, streaming, model hints |

No special transition concerns for Steps 2-9. Each is a normal PR off main.

---

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| `dist/` in git creates merge noise | CI check verifies dist matches source; remove from git when npm publishing is set up |
| `dist/` not self-contained (missing bundled deps) | tsup bundles deps by default; CI step verifies `dist/index.js` runs without `node_modules/` |
| Node.js not installed or wrong version | Bash wrapper checks both existence AND version `>=18`; prints clear install hint |
| Behavioral drift from Python | Port tests first using Python tests as spec; systematic parity check (exit codes, error messages, all flags) before switching wrapper |
| CLI parity subtleties (Commander.js vs argparse) | Test argv normalization, exit codes, error messages explicitly; accept semantic equivalence over exact wording |
| Breaking live Claude plugin | Wrapper switch is one commit; `git checkout -- phone-a-friend` instantly restores Python |
| CI changes break main | CI changes are on feature branch; main is untouched until merge |
| Version sync drift during transition | Triple sync enforced: `pyproject.toml` + `package.json` + `plugin.json` (CI checks all three) |
| Pre-release version in GitHub Releases | Add `prerelease` flag to release workflow for versions containing `-` |
| Shell injection in subprocess calls | All subprocess calls use `execFile` with arg arrays, never shell strings |

---

## Review Feedback

This plan was reviewed by both **Codex** and **Gemini**. Both gave "partly agree" — sound overall approach, practical gaps identified. Key improvements have been incorporated into the plan above.

### Codex Review (Round 1)

**Verdict:** Partly agree.

**Top Risks / Gaps:**

1. **Version sync transition is inconsistent** — Current repo enforces `pyproject.toml` <-> `.claude-plugin/plugin.json` in CI. Plan introduces `package.json` as source of truth but keeps Python around until Step 6 without clearly keeping `pyproject.toml` in sync during the transition. Risk: PR CI fails intermittently or release logic/drift becomes confusing. **Fix applied:** Triple sync (`pyproject.toml`, `package.json`, `.claude-plugin/plugin.json`) until Python is removed.

2. **`dist/` committed may still be insufficient if runtime deps are externalized** — Only true if `dist/index.js` is self-contained (bundled runtime deps like `commander`). Risk: wrapper switches to Node, plugin works on dev box but fails on another machine because `node_modules/` is missing. **Fix applied:** CI step that moves `node_modules` aside and verifies `dist/index.js` runs standalone.

3. **Step 1 scaffold validation likely fails as written** — `npx tsc --noEmit` with `include: ["src/**/*.ts"]` and no `src/*.ts` often fails with "No inputs were found" (`TS18003`). **Fix applied:** Removed `tsc --noEmit` from Task 1; TypeScript validation happens naturally when first source file is added in Task 2.

4. **CLI parity risk is larger than the plan suggests** — Current CLI has non-trivial behavior: Typer + argparse fallback, `_normalize_argv`, top-level `install/update/uninstall`, and likely specific error/exit semantics. Commander defaults will change help/error formatting and exit codes unless wrapped carefully. **Fix applied:** Added parity tests for argv normalization, exit codes, and key error messages before switching the wrapper.

5. **Some TS translations propose less robust subprocess handling than current Python** — Plan mentioned `execSync('git diff')` and shelling out to `which`. Current Python uses safe subprocess arg lists. **Fix applied:** All subprocess calls use `execFile/execFileSync` with arg arrays everywhere.

**Execution Sequence Corrections:**

1. Add Node CI early, not near the end (catches TS test/build regressions during the port)
2. Keep Python CI and version checks through the wrapper switch
3. Move versioning transition into an explicit "transition policy" task
4. Add one "runtime packaging verification" check before wrapper switch
5. Keep wrapper switch as the last runtime change, but update CI before it

**On `dist/` in git:** Conditionally sound for this repo's plugin/symlink model. Only sound if: `dist/index.js` is self-contained, CI checks `dist/` freshness, build output is deterministic enough for CI checks.

**On bash wrapper as atomic switch:** Yes, right abstraction. Improvements applied: guard for missing `dist/index.js`, Node.js version check.

---

### Gemini Review (Round 1)

**Verdict:** Partly Agree.

**Top Risks / Gaps:**

1. **Synchronous Subprocess Calls and Error Handling** — `child_process.execFileSync` for external commands (`which`, `claude`, `git diff`) is synchronous and can block the event loop. More critical: need robust, standardized error handling for all subprocess calls including parsing non-zero exit codes, capturing `stderr`, and providing user-friendly messages for all types of subprocess failures.

2. **Completeness and Fidelity of Python Test Porting** — Simply translating Python tests might miss subtle behavioral nuances or edge cases specific to the Node.js/TypeScript environment, especially concerning subprocess interactions, file I/O, or argument parsing.

3. **`dist/` Synchronization in CI and Developer Friction** — CI check catches `dist/` being out of sync when rebuilt on CI. Primary risk is developer error: modifying source code but forgetting to `npm run build` and commit the updated `dist/` locally before pushing.

4. **Limited Parity Verification Post-Switch** — Using `head -5` of output for a quick check is insufficient. Subtle differences in output formatting, error wording, or exit codes could break downstream automation or user expectations. **Fix applied:** Thorough parity verification with systematic exit code + error message comparison.

5. **Missing Node.js Version Check in Bash Wrapper** — Proposed wrapper checks for the `node` command's existence but doesn't explicitly check for the required Node.js version (`>=18`). **Fix applied:** Added explicit version check in bash wrapper.

**Suggested Improvements:**

1. **Keep Python CI Post-Merge** — Consider keeping both Python and Node CI jobs running on `main` for 1-2 release cycles as an additional safety net.

2. **Enhanced Parity Verification** — Develop a dedicated integration test script that systematically executes commands against both Python and TypeScript versions, capturing full stdout/stderr/exit codes, then automatically diffs their outputs and return statuses.

3. **Robust Subprocess Utility** — Abstract common subprocess execution logic into a dedicated TypeScript utility function (`runCommand(command, args, options)`) that consistently handles stdout/stderr capture, error reporting for non-zero exit codes, and offers synchronous/asynchronous options.

**On `dist/` in git:** Sound and pragmatic for the given constraints. The Claude plugin's symlink installation mechanism needs a built `index.js` readily available. CI verification step provides a necessary guardrail.

**On bash wrapper as atomic switch:** Yes, right abstraction. Minimal risk, instant reversibility, ubiquity.

---

### Conclusion

Both reviewers converged on the same core assessment: the plan is architecturally sound but had practical gaps. All critical feedback has been incorporated:

| Feedback | Source | Status |
|----------|--------|--------|
| Triple version sync during transition | Codex | Incorporated |
| Self-contained `dist/` verification in CI | Codex | Incorporated |
| Remove `tsc --noEmit` from Task 1 | Codex | Incorporated |
| Node.js version check in bash wrapper | Gemini | Incorporated |
| `dist/index.js` existence guard in wrapper | Codex | Incorporated |
| Thorough parity verification (exit codes + error messages) | Gemini | Incorporated |
| `execFile` with arg arrays everywhere | Codex | Incorporated |
| CLI parity tests for argv normalization | Codex | Incorporated |

**Not incorporated (deferred or not applicable):**

| Feedback | Source | Reason |
|----------|--------|--------|
| Keep Python CI post-merge on main | Gemini | Deferred to Step 6 decision; adds complexity for marginal safety on an alpha release |
| Dedicated parity integration test script | Gemini | Manual parity check in Task 8 is sufficient for Step 1; automated parity testing is over-engineering at this stage |
| Reusable `runCommand()` subprocess utility | Gemini | Premature abstraction — only 3-4 subprocess call sites; can extract if pattern repeats in Steps 2-5 |
| Async subprocess calls over sync | Gemini | CLI is short-lived; sync calls are simpler and correct for this use case; no event loop concerns |

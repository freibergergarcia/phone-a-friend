# Backend and functionality audit — 2026-10-31

Status: audit findings and fixes validated; full live acceptance remains incomplete.
This is an execution log, not a certification that all backends or supported
environments pass. Baseline: PaF 4.14.1, commit `51fe7c4`,
macOS, Node 24.22.1. Existing worktree was clean before this audit.

Independently reviewed and corrected on 2026-11-01. "Review bundle" below means
the bundle as the audit finished it; "final bundle" means after the review's fixes.

## Execution checklist

- [x] Inventory installed backend versions and current stable releases.
- [x] Capture installed command help; also capture latest Gemini and OpenCode 1.x help in isolated npm executions.
- [x] Run existing automated baseline and Claude mod validation/tests.
- [x] Strengthen the existing live probe with semantic assertions and safe fixture allocation.
- [x] Compare emitted flags and protocols with installed/latest help and official references; document semantic limits.
- [ ] Complete live acceptance for every backend and both OpenCode lines.
- [x] Extend live cases to review scopes, context, raw sessions/adoption, schemas on resume, and flag combinations; retain failed cases and their dispositions.
- [ ] Complete failure, cancellation, permission-boundary, and process-cleanup audits.
- [x] Exercise packed npm artifact installation/update/uninstallation for all five hosts, using copy and symlink modes in disposable directories.
- [ ] Complete manual TUI, setup, and host-skill workflow checks.
- [x] Fix Codex failure reporting, Gemini turn-limit reporting, Ollama response handling, Claude preflight bounds, and the probe harness; rerun regressions.
- [x] Run final full suite and distribution checks; record remaining limitations below.

## Versions and evidence

Stable npm versions were queried with `npm view <package> version --json` on
2026-10-31. Antigravity/Ollama stable versions were checked through upstream
GitHub release metadata; Grok through its official changelog. An installed
Ollama client does not establish which server version handles API requests.
Isolated npm executions do not replace the user's globally installed tools.

| Backend | Installed | Current stable checked | State |
|---|---|---|---|
| Antigravity | 1.4.12 | [1.4.12](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.4.12) | 11/11 initial live cases; 11/11 on the review bundle |
| Claude | 2.1.316 | `@anthropic-ai/claude-code` 2.1.316 | 11/11 initial live cases; 11/11 on the final bundle |
| Codex | 0.166.0 | `@openai/codex` 0.166.0 | 11/11 on the final bundle, after correcting the verdict assertion (A02); failure-reporting change in A01 |
| Gemini | 0.46.0 | `@google/gemini-cli` 0.66.0 | Not validated live: installed and isolated latest CLI both report missing authentication. The turn-limit fix (A08) is tested with fixtures only |
| Ollama | client reported 0.40.2 during the audit and 0.40.13 when rechecked on 2026-11-01 (cause of the change not established); isolated server API reported 0.40.13 | [0.40.13](https://github.com/ollama/ollama/releases/tag/v0.40.13) | 11/11 with local Qwen3 4B, also on the review bundle; initial 0.6B failures retained |
| OpenCode | `@opencode/cli` 2.2.5 | 2.2.5; `opencode-ai` 1.19.5 | 1.19.5: 12/12 with `opencode/beam-free`, also on the review bundle. 2.2.5: 12/12 during the audit and on the final bundle; on the review bundle `verdict` hit `provider.free-limit` and quota blocked retries until 2026-11-02. Original default-provider HTTP 401 retained |
| pi | 1.4.0 | `@earendil-works/pi-coding-agent` 1.4.0 | 12/12 with OpenRouter Qwen3 Coder and 12/12 with local Qwen3 4B, both also on the review bundle; initial 0.6B failures retained |
| Grok | 1.0.70 | [1.0.70](https://x.ai/changelog/build) | 11/11 initial live cases; 11/11 on the review bundle |

Raw evidence (help snapshots, test logs, probe stdout and stderr, per-run result
files) was kept locally and is not in this repository, because it contains local
paths. A reboot on 2026-11-02 removed it, so this report is the remaining record. No
credentials were opened or copied into this report. Backend CLIs use
their existing authentication mechanisms.

During the audit, four cloud backends passed 11/11 and pi and both OpenCode lines
passed 12/12 on the named cloud models. Local Qwen3 4B then passed 11/11 through
Ollama and 12/12 through pi. Seven of eight backends have at least one passing
route. Gemini is blocked by authentication. Counts describe the probe, not all
extended cases.

For local inference, the configured Ollama model directory was unavailable. A separate server on `127.0.0.1:11439` used a temporary model directory
and Qwen3 0.6B (about 523 MB). Direct Ollama passed 7/11 and pi through its
OpenAI-compatible endpoint passed 9/12. Incorrect recall, JSON shape, punctuation,
and review conclusions remain failures. A second model, Qwen3 4B (about 2.5 GB),
passed every probe case through both adapters. This demonstrates a working local
route without treating the smaller model's errors as passes or guaranteeing model
reasoning quality. The owned server was stopped after the local probes. No global
provider/model setting changed; see "State left outside the repository".

## Baseline results

| Check | Result |
|---|---|
| `npm ci` | Passed; two development dependency advisories reported |
| `npm test` | 73 files, 1,821 tests passed |
| `npm run typecheck` | Passed |
| `npm run plugins:check` | Passed |
| `npm run build` | Passed; baseline generated bundle unchanged |
| `npm run plugins:pack` | Both plugin archives built and validated |
| `claude plugin validate --strict mods/paf-tasks` | Passed on 2.1.316; directory-only missing-icon warning |
| `claude plugin test mods/paf-tasks` | 43 tests passed |

The full baseline includes TUI, CLI, configuration, setup, diagnostics, updates,
installer, sessions, jobs, tasks, SQLite concurrency/migration, agentic lifecycle,
review-scope, parser, backend, and distribution tests. Passing the suite does not
prove live authentication, provider compatibility, or untested platform behavior.
Windows has not been executed. Linux results are under "Review results".

## Command compatibility review

Compare each source argument builder against the references below and the exact
installed executable's help. Help acceptance is evidence of parsing support;
only live execution establishes semantics. Hidden accepted flags must not be
declared broken simply because they are missing from help.

| Backend / source | Current reference | Checked surface and outstanding work |
|---|---|---|
| `src/backends/antigravity.ts` | [CLI](https://antigravity.google/docs/cli/reference/), [headless](https://antigravity.google/docs/cli/headless/), [sandbox](https://antigravity.google/docs/sandbox/) | Emitted flags present in 1.4.12 help. Recheck plan-mode/tool restrictions separately from OS sandbox availability. |
| `src/backends/claude.ts` | [CLI](https://code.claude.com/docs/en/cli-reference) | Print/JSON/stream, schemas, session and tool flags checked. `--max-turns` absent from short help but accepted and exercised live. Native mode exercised in the main probe; explicit accept (batch) and refuse (stream) both passed live. This does not prove cross-session peer delivery. |
| `src/backends/codex.ts` | [CLI](https://learn.chatgpt.com/docs/cli/reference) | Separate exec/resume/review help captured. Resume now advertises `--output-schema`, matching PaF's capability probe. Resume/schema, raw attach/adoption, review/session and review scopes passed; hostile-rule containment on resume/review remains unproven. |
| `src/backends/gemini.ts` | [CLI](https://geminicli.com/docs/cli/cli-reference/) | Emitted flags present in captured help. `--yolo` is deprecated but accepted; source already acknowledges this. Authentication/trust prevented live feature validation. |
| `src/backends/ollama.ts` | [Chat API](https://docs.ollama.com/api/chat) | `/api/chat`, messages, stream and schema-format fields reviewed. Server version, batch/schema/stream protocols exercised locally; terminal text and empty-output defects fixed below. Tiny-model acceptance failures retained. |
| `src/backends/opencode.ts` | [CLI](https://opencode.ai/docs/cli/) | 1.19.5 help includes `--dir`/`--pure`; 2.2.5 uses cwd and supports `--standalone`. Both lines passed the acceptance probe, review-scope cases, and resumed-session cases with `opencode/beam-free`. |
| `src/backends/pi.ts` | [Upstream CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md) | JSON, tools, discovery restrictions, provider/model and session flags present in 1.4.0 help. Cloud and local-provider runs completed. Local-model semantic failures retained; hostile project rules were not exhaustively revalidated on this release. |
| `src/backends/grok.ts` | [CLI](https://docs.x.ai/build/cli/reference), [headless](https://docs.x.ai/build/cli/headless-scripting) | Emitted flags accepted in 1.0.70, including hidden `--no-auto-update` (help parse and live calls). Allow/deny merging and cancellation still need adversarial fixtures. |

The apparent OpenCode documentation conflict is resolved: 2.x rejects the
underlying `--dir`/`--pure` flags, while PaF suppresses those flags and makes
`--fast`/pure requests no-ops on known 2.x. Unknown-version requests fail closed.
The installed 2.x and isolated 1.x help agree with that distinction.

Antigravity's current reference says sandbox availability depends on the machine
and `--sandbox` can be ineffective when unavailable. Do not infer strict
containment solely from the presence of that flag. Preserve the compatibility
constraints in `docs/security/2026-05-09-backend-sandbox-redesign.md` when deciding
on changes.

## Findings and changes

### A01 — Failed Codex exit with a last-message file reported as completed (defensive fix)

Both `run()` and native `review()` returned the last-message file from their
error handler. A child that wrote that file and then exited non-zero caused CLI
exit 0, successful stdout, and a completed task. Real-subprocess tests in
`tests/tasks-cli.e2e.test.ts` reproduce this against a fixture executable and fail
on the unfixed code.

Real Codex did not reproduce it. The review ran 16 scenarios against a local stub
model server (failed, truncated and overflowing responses, HTTP errors, dead MCP
servers, failing tools, rejected approvals, a hang). It used Codex 0.166.0, 0.157.0
and 0.140.0 on macOS, with the raw CLI and PaF before and after this fix, and the
raw CLI only for 0.120.0, 0.100.0 and 0.80.0 on Linux. No run exited non-zero with
a non-empty last-message file, and PaF's exit and stdout were identical before and
after the fix. 0.100.0 and 0.80.0 have no `exec review` (exit 2). Codex 0.166.0's
source agrees: the file is written only for a completed turn. The audit's "could
report success" therefore describes a path current Codex was not seen to reach.

The backend now throws `CodexBackendError` on a failed exit, timeout or signal even
if the file exists, and the file's content is discarded. If a future Codex exits
non-zero after a complete answer, PaF will report failure, not the answer. The
audit's `partialOutput` error field was removed in review because nothing read it.

### A02 — Probe could falsely pass wrong answers (fixed)

The old probe mostly counted exit statuses and used a substring match for job
results. It could pass incorrect recall, wrong schemas, or empty review findings.
`scripts/assert-probe.mjs` now checks exact fixture answers, schema values,
arithmetic findings, session identity/storage, and terminal task records. It
rejects protocol leakage and unsupported assertion names. Eight regression tests
cover false-positive cases.

A valid Codex verdict initially failed because the arithmetic diagnosis was in
the summary and the finding gave a numerical example. The assertion now considers
the summary together with the finding, with a regression test. Its saved output
passes revalidation; the original run's summary is retained as historical evidence.

pi's OpenRouter `review` case also failed its original assertion and passed only
after that assertion was broadened. It now requires naming `math.js` or `add` and
mentioning subtraction, which shows the bug was noticed, not that the reasoning was
sound. Both backends also passed on the review bundle under the current assertions.

### A03 — Probe could delete a reused output directory (fixed)

Each invocation now creates a unique directory beneath `PAF_PROBE_OUT`; no
recursive deletion occurs. CLI arguments use a Bash array, preserving paths with
spaces. The entire run is parsed as a function before slow calls start, preventing
source edits from changing an in-flight run. An early Antigravity run was
interrupted by an edit before that protection was added; it was restarted only
after the process had exited.

### A04 — Development dependency advisories (one fixed, one deferred)

Updated only `source-map-js` from 1.2.1 to 1.2.2 in the lockfile. Upstream
[1.2.2 release notes](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
identify the malicious indexed-source-map denial-of-service fix. npm also
synchronized the lockfile's previously stale root version with existing 4.14.1;
no package or plugin version was bumped.

The remaining low-severity
[esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr)
affects its development server on Windows. PaF's build/watch commands do not
serve files. tsup 8.5.1 requires `esbuild ^0.27.0`, while the fix is 0.28.1+;
the current tsup 9.0.0 uses `esbuild ^0.28.2`. A major build-tool migration or
forced override is deferred from these scoped runtime fixes.
`npm audit --omit=dev` reports zero advisories. Full audit now reports one low
advisory.

### A05 — Ollama dropped terminal text and accepted empty streams (fixed)

The NDJSON parser returned on `done: true` before reading that record's content.
It now yields terminal content before stopping, including EOF without a trailing
newline. This matches the [documented streaming format](https://docs.ollama.com/api/streaming).
Ollama now rejects completed empty/whitespace-only streams, explicit incomplete
batch responses, and non-object JSON envelopes. Non-string batch content produces
a backend error rather than an accidental `.trim()` TypeError. Missing batch
`done` remains accepted for compatibility; explicit `done: false` is rejected.

New tests reproduced the defects before the changes. Parser/backend checks
passed (73 tests), then the final full suite passed. This does not upgrade
schema-in-prompt backends into native schema validators.

### A06 — Claude version preflight could stall before the relay timer (fixed)

Every Claude relay synchronously probes `claude --version` for peer-messaging
support. That probe had no timeout or output cap. A real executable fixture that
ignores TERM reproduced the delay in both streaming and batch calls. The probe
now has a three-second timeout, SIGKILL termination, and a 16 KiB output cap.
The bounded synchronous preflight still blocks the event loop for up to three
seconds; it is not an async redesign. Two subprocess regressions cover this.

The audit's version reported a timeout as "requires Claude Code v2.1.224 or later",
fell back silently in `native` mode, and dropped `refuse` without saying so. After
review, a probe that times out, fails or prints no version makes `accept` and
`refuse` fail before any model request with the real cause. `native` warns on stderr
and keeps the older tool set. A readable older version behaves as before.

### A07 — Existing timeout and sandbox limits remain (open design work)

`spawnCli()` only escalates TERM to KILL when its caller supplies `killGraceMs`.
pi and Grok opt in; Antigravity, Claude, Codex, Gemini and OpenCode batch calls do
not. The existing stubborn-child regression explicitly demonstrates the default
can remain unsettled after the requested timeout. Claude/OpenCode direct streams
also lack that escalation. A timeout is therefore not a universal hard deadline.
pi/Grok do not own process groups, so tool descendants may survive their parent.
Agentic mode does own process groups and passed its real-subprocess TERM-resistant
descendant, deadline, explicit stop, SIGINT and SIGTERM regressions.

**Update, 2026-11-02:** the timeout half of this finding is fixed (issue #202). See
"Timeouts" in `AGENTS.md` for the current behaviour and its limits. The sandbox
results below are unchanged.

Read-only sentinel attempts preserved files for Claude, Codex and Grok. Their
workspace-write and danger-full-access cases wrote only the disposable canary.
Antigravity rejects unsupported write modes and preserved its canary, but its
read-only write-attempt call timed out. These checks do not prove OS containment.
OpenCode's sandbox remains host-managed, Gemini's plan-mode mapping best-effort,
and pi's restriction a tool allowlist. No incompatible default-mode rejection
was introduced; the existing sandbox redesign decision still applies.

### A08 — Gemini turn limit reported as success (fixed; found in review)

`runOnce()` returned stdout as a successful answer when Gemini exited 53, which
PaF's code treats as the turn limit. The truncated text became CLI exit 0 and a
completed task. This predates the audit and had no test. It now throws
`GeminiBackendError` and discards the output, matching A01.

A fixture through the built CLI went from exit 0 with partial text to exit 1, a
failed task and a null result. Five new unit cases cover text, JSON, unparseable and
empty output. Real Gemini was not exercised because authentication is missing.
Callers that relied on partial output at the turn limit now get a failure.

## Extended evidence and final validation

- Extended sessions: Claude, Codex, Grok and Antigravity passed schema-on-resume,
  raw attach, adoption and review with managed sessions. Combining context files
  and inline context correctly failed CLI validation; separate supported context
  cases ran as below.
- Context and permissions: all 16 checks passed, covering ordered context files,
  inline context, write-mode canaries or expected mode rejection.
- Additional sessions: pi passed all nine extended cases. OpenCode 2.x passed its
  session/context contracts and task-history opt-out; its strict answer check
  recorded `PONG.` instead of `PONG`. The initial 1.x extension omitted its isolated
  data directory and could not find its session. A retry restored that directory and
  confirmed all session/context contracts; its same punctuation failure is retained.
- Flags: Claude explicit peer accept/refuse and OpenCode 2.x standalone each
  returned the exact expected answer.
- Review scopes: staged, unstaged and untracked defects were detected for
  working-tree scope, and the branch defect was additionally detected for all scope,
  on Claude, Codex, Grok, pi and both OpenCode lines. Antigravity all-scope passed in
  79 seconds; working-tree timed out at 90 seconds. The same fixture passed in 55
  seconds on a 180-second retry; the original timeout is retained.
- Agentic: live Claude routing/convergence, timeout and unsupported-backend rejection
  passed. The attempted unresolved turn-cap case actually converged; it does not
  prove that failure path. Deterministic subprocess tests separately cover both
  completed and pending work at the cap.
- `tests/installer-artifact.e2e.test.ts`: actual `npm pack`, extraction without
  node_modules, and install/update/uninstall of all five hosts in both copy and
  symlink modes passed. Vendor marketplace shell-outs were disabled; existing
  unit tests cover their argument and rollback behavior.
- Packed runtime: a fresh local npm installation of
  the tarball with production dependencies passed version/help, config creation
  and retrieval, and empty task/session-store commands outside the checkout.
- Manual PTY check: fresh setup selected Codex, declined the five host-install
  prompts, saved a disposable config, and completed the live quick test.
  All five dashboard tabs rendered; config selection persisted, backend refresh
  completed, the empty agentic view rendered, and `q` exited cleanly. Resize,
  external-editor and destructive UI actions were not exercised.
- Live `doctor --json` completed within a second. It correctly identified the
  checkout as 4.14.1 and the PATH install as 4.13.5, plus the existing Claude
  marketplace source mismatch and missing local Ollama endpoint. Its exit 1
  reflects that environment; no global installation/registration was changed.
- Audit's final `npm test`: 76 files, 1,847 tests passed. Typecheck, build, plugin
  synchronization/validation, shell syntax and diff whitespace passed. Final plugin
  archives, baseline standalone bundle smoke and 43 Claude-mod tests also passed; no
  mod source changed during this audit.

## Review results

The review repeated the checks independently instead of relying on the audit's logs.

**Final bundle**

- macOS: 76 files and 1,859 tests passed. Typecheck, plugin checks and archives,
  strict mod validation, 43 mod tests, shell syntax and diff whitespace passed, and
  the bundle rebuilt byte for byte.
- Live probes on the real CLIs: Claude 11/11, Codex 11/11 and OpenCode 2.2.5 12/12,
  including `verdict`. Explicit Claude `accept`, `refuse` and `native` calls each
  returned the expected answer. Other backends' sources did not change, so their
  probes were not repeated, and the Gemini change has fixtures only.
- Linux arm64 on Node 22: `npm ci`, plugin checks and archives, bundle reproduction,
  standalone bundle, 1,859 tests and typecheck passed. Claude plugin validation and
  mod tests were left out of this run, and they passed on macOS.
- Linux amd64 under emulation (2 CPUs, 2 GB): not clean, but not caused by this work.
  The three tests that failed on the review bundle passed in all three full runs,
  taking up to 8.1 seconds under their new limits. Other failures moved between runs:
  a vitest worker SIGSEGV, scripts exiting non-zero in `plugin-distribution`, and, at
  `--maxWorkers=2`, three 5-second timeouts and a 5.8-second result against a 5.5-second
  deadline assertion. `plugin-distribution` failed 2 of 12 runs on both the unmodified
  baseline and the final tree.
- GitHub CI on native x64 Ubuntu with Node 22: 76 files and 1,859 tests passed, along
  with Claude manifest validation and 43 mod tests.

**Review bundle**

- macOS: 76 files and 1,847 tests passed, the bundle rebuilt byte for byte, and 16
  new or changed tests failed on the unfixed baseline.
- Live probes with no failed case: Antigravity, Claude, Codex, Grok, OpenCode 1.19.5,
  pi (OpenRouter and local Qwen3 4B) and Ollama (local Qwen3 4B). OpenCode 2.2.5 is
  the exception shown in the version table.
- Linux arm64, replicating the CI steps on Node 22: every step passed, including
  1,847 tests, 43 mod tests and bundle reproduction.
- Linux amd64 under emulation: every other step passed, but 3 of 1,847 tests failed:
  `m1-cli` schema thread, `tasks-cli` native review, and `tasks-cli` partial output
  after timeout. The last hit vitest's 5-second limit. The others' messages were
  truncated, so slowness is probable but unproven. Both files now have a 60-second
  limit (`m1-cli`'s failing test starts the CLI five times and takes 1.4 seconds
  natively).

## State left outside the repository

Fixtures were meant to be disposable, but this state remained afterwards:

- A trust entry for a temporary probe repository in `~/.codex/config.toml`, from a
  live probe on 2026-10-31. The review removed it and that temporary repository.
- A probe entry and folders under `~/.gemini`, and six `~/.claude/projects` folders for
  temporary repositories. The review removed these. A reboot cleared hundreds of `paf-*`
  temporary folders and a 2.8 GB temporary Ollama model directory.
- Not removed: Codex session logs from probe runs in `~/.codex/sessions`.
- The review's older Codex builds were deleted afterwards. macOS blocks 0.100.0 and
  0.120.0 because their signing certificates are revoked, so test those only on Linux.

## Coverage limits and follow-up

| Area | Evidence completed | Remaining limitation |
|---|---|---|
| Relay/context/config | Full suite; live ordered/inline context and task opt-out; manual setup/config | Gemini live calls need authentication |
| Review scopes/verdict | Deterministic scope tests; extended live scope results alongside this report | Initial 0.6B model missed real bugs; 4B passed the probe. Antigravity timeout/retry evidence retained |
| Sessions | Native recall, schema resume, attach/adopt and review/session across six backends and both OpenCode lines; local transcript/native sessions exercised | Gemini session compatibility unverified; long-lived cross-version migrations not live-tested |
| Tasks/jobs/progress | Quiet/result probes, task inspection, opt-out comparisons, failed Codex task regressions, SQLite concurrency/migration tests | No exhaustive crash-at-every-write-point campaign |
| Subprocess/streams | Malformed/partial/empty output, signal/timeout/early-return tests; agentic real process cleanup | Regular relay hard-deadline and descendant limits described in A07 |
| Permissions | Live canaries and argument-policy tests | Not a hostile-project or OS-isolation certification; strict redesign remains separate |
| Agentic | Live routing/convergence/timeout; real subprocess stop, cap, signals, descendants | No non-Claude adapter exists; no long-duration soak |
| Setup/doctor/updates | Full suite, fresh interactive setup and live doctor | Provider auth unavailable to doctor; installed PATH version differs from checkout |
| Host integrations | Actual npm artifact on five disposable host homes, both modes; rollback tests | Real marketplace mutations and each vendor's live skill-discovery UI not exercised |
| TUI/mod | PTY tab/config/refresh/quit checks; TUI unit tests; mod validation and 43 tests | Terminal resize, real host mod rendering, external editor and destructive actions not manually checked |
| Distribution | Build, plugin checks/archives, standalone smoke, packed-installer test; Linux arm64 CI replica | Linux amd64 is flaky only under emulation, on the baseline too, and passes natively in CI; Windows not run |

The original promise of all-backend live acceptance is not yet met. Gemini needs
usable CLI authentication (do not paste credentials into the audit), and all
successful routes are limited to the recorded versions, models and fixtures. Re-run `scripts/probe-backends.sh gemini`
after authentication. Resolve the remaining design/platform limits explicitly before
treating this as a release certification. No backend CLI was installed or changed
globally, and nothing was published.

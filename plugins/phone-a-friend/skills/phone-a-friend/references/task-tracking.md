## Background reviews and task tracking

Newer PaF binaries record every relay and review as a task in a local SQLite
store (`~/.config/phone-a-friend/tasks.db`) and print one stderr line when the
run starts:

```text
◇ Task 3f9a2c1d started · phone-a-friend task show 3f9a2c1d
```

Probe once per conversation so stale binaries degrade gracefully:

```bash
if "$RELAY_BIN" task --help >/dev/null 2>&1; then PAF_TASKS=1; else PAF_TASKS=0; fi
```

**Run reviews in the background on the Claude Code host.** A code review can take
minutes; do not block the conversation on it.

1. Preferred: delegate to the plugin subagent `phone-a-friend:paf-reviewer`
   through the Agent tool with `run_in_background: true`, passing the exact
   relay command as the prompt (the same command you would run yourself,
   including the heredoc that writes the prompt file). Do not give it a
   `name`: with agent teams enabled a named subagent becomes a teammate,
   and teammates cannot run background Bash. The review then appears in the
   agent panel and `/tasks`, its verbose output stays out of your context,
   and it returns a receipt plus the verbatim findings when it finishes.
   Fallback when that subagent type is unavailable (older plugin, `-p`
   mode): run the command yourself with the Bash tool's
   `run_in_background: true`.
2. Tell the user the review started and give them the task id in one
   sentence. With the Bash fallback, read the `Task <id> started` line from
   the early output. With the subagent, the id is not visible until it
   reports back, so after a few seconds run
   `"$RELAY_BIN" task list --repo "$PWD" --status running` and quote the
   id from there, for example: "Codex review started (task 3f9a2c1d). I'll
   pick up the result when it finishes; `phone-a-friend task show 3f9a2c1d`
   shows progress from any terminal."
3. Keep working on the user's next request. Do not poll. The host notifies
   you when the background command exits.
4. On completion, read the command output: the relay result is on stdout and
   `Task <id> completed` (or `failed`) is on stderr. Trust that line, not the
   host's exit code: when the command finishes between turns the host may
   report the exit code as unknown or -1 although the relay succeeded. If the
   output is no longer in context, run `"$RELAY_BIN" task result <id>`.
5. If stderr says the working tree changed during the review, say so and
   offer a re-review: the result covers the snapshot captured at start.

Hosts without background shell tasks run the relay synchronously; the task
record is still written and the same `task` commands work.

**Answer shape.** When the review finishes, lead with a one-line receipt
taken from the command output or `"$RELAY_BIN" task show <id>`: task id,
backend, scope, duration, and whether the tree changed during the review.
Then the findings, then the next action. If the user asks how the review is
going, run `task show <id>` and answer with elapsed time and the last
reported event; the background output also carries progress lines
(`◇ 00:12 Running: git diff`), so read that file rather than re-running
anything. Never invent progress the backend did not report. If the user has
the PaF status line configured (`phone-a-friend task status-line`), they can
already see elapsed time and the last event, so keep unprompted chat updates
sparse.

**Finding earlier work.** When the user asks what happened to a review, or
wants to continue one:

```bash
"$RELAY_BIN" task list --repo "$PWD"   # newest first, this repository
"$RELAY_BIN" task show <id>            # scope, backend session, drift check, event log
"$RELAY_BIN" task result <id>          # stored result; exit 3 while still running
```

`task show` includes the backend session id; pass it as `--backend-session`
(or reuse the original `--session` label) to continue that conversation.

**Honesty rules.** A `running` task with no recent events is not proof of a
hang; report elapsed time and the last event. `interrupted` means the owning
PaF process exited without reporting, and the backend may still have finished
on its side. Never claim a result exists until `task result` prints it.

**Retention.** `defaults.task_history = "results" | "metadata" | "off"` (or
`PHONE_A_FRIEND_TASK_HISTORY`); `--no-task-history` skips one run. Prompts are
stored as a 200-character preview plus a hash and diffs as a hash only.
Deleting a task does not delete the backend's own session.

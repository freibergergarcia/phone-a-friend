# Privacy and local data

Phone a Friend is open-source software maintained by Bruno Freiberger. It runs
on your machine. The project operates no relay service and includes no analytics
or telemetry collector.

## Where requests go

The CLI sends your prompt, supplied context, and any requested diff to the backend
you select. Backends include locally installed Claude, Codex, Gemini, Antigravity,
OpenCode and pi CLIs, and an Ollama HTTP endpoint. A local CLI may send data to
its configured model provider; using a local CLI does not mean inference stays
on your machine. Ollama and pi/OpenCode can also use model servers you configure.
Their providers' terms, privacy policies, authentication, billing and retention
apply independently of this project.

Repo-aware backends can inspect files using their own tools. Choose the repository,
context and permissions accordingly. The default PaF sandbox is read-only, but
the enforcement mechanism depends on the backend; see the
[backend documentation](https://github.com/freibergergarcia/phone-a-friend#backends).

The optional update check requests this package's release metadata from the npm
registry. It sends no prompt or repository contents; npm can receive ordinary
connection information such as your IP address. Disable it with
`PHONE_A_FRIEND_UPDATE_CHECK=false` or `defaults.update_check = false`.
Installing/updating packages and host integrations also contacts their configured
registries or Git repositories.

## What remains locally

PaF normally stores configuration and history beneath
`~/.config/phone-a-friend/` (or `$XDG_CONFIG_HOME/phone-a-friend/`). This includes
session labels and backend IDs, replay history where needed, background jobs,
agentic transcripts, task events/results and update metadata. Outputs, errors,
file paths and tool progress may contain sensitive information. Native backend
sessions are also subject to that backend's storage behavior; PaF-owned pi
session files are separate from the session-label database.

Task retention is configurable:

- `defaults.task_history = "results"` (default): result text, a short prompt
  preview, scope hashes, metadata and events.
- `"metadata"`: omit the dedicated prompt-preview and result fields. Metadata
  and events remain, including commands, errors and any answer excerpts a
  backend reports as progress. For example, Codex message events can retain
  up to 300 characters of an assistant message, including the final answer.
- `"off"`, or `--no-task-history` for a single call: no task record for that run.

These settings control the task store only. They do not disable session history,
background job output, agentic transcripts or the backend's own history. Use
`task delete`, `task prune`, `session delete` and `session prune` as appropriate;
deleting a PaF record does not delete native backend history. Package removal
preserves PaF configuration/history. To erase all PaF data, stop running jobs,
back up anything needed, then remove the PaF configuration directory yourself.
Manage backend history using that backend's controls.

Task records and agentic transcripts have no automatic age-based expiry; they
remain until explicitly pruned or deleted. Managed sessions are capped at 100,
evicting least recently used records when a new session exceeds the cap. Creating
a job above the 50-record limit removes the oldest finished jobs where possible;
active jobs can keep the store above that limit. These count limits do not erase
backend-native sessions or PaF-owned pi session files.

## Support and changes

GitHub issues are public. Share only sanitized diagnostics, never API keys,
tokens, personal data or private code. GitHub handles information you submit to
it under its own policies. For support and private vulnerability reporting, see
[SUPPORT.md](SUPPORT.md). Changes to this notice are versioned in this repository.

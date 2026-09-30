# pi JSONL fixtures

Event streams from `pi --mode json` (pi 0.87.1, `@earendil-works/pi-coding-agent`),
captured 2026-09-30 against a local OpenAI-compatible server and used by
`tests/backends/pi-parse.test.ts` and the pi backend tests.

Every capture ran in a throwaway repository with
`--mode json --no-approve -ne -np --no-themes --tools read,grep,find,ls` and
stdin closed.

| File | What it shows |
|---|---|
| `session-start.jsonl` | First call with `--session-dir` + `--session-id`. Final message is `[thinking, text]`, `stopReason: "stop"`. |
| `session-resume.jsonl` | Second call on the same ID. The original header is re-emitted with its original timestamp. |
| `tool-calls.jsonl` | The model is asked to write a file with only read tools. Two `toolUse` assistant messages and two failed `read` calls precede the final `stop` message. |
| `error-exit-zero.jsonl` | Unknown model ID on a valid provider. pi exits 0; the final assistant message has `content: []`, `stopReason: "error"` and `errorMessage`. |
| `retry-connection-error.jsonl` | Provider on a closed port. Three auto-retries, four assistant `message_end` records, all errors, then `auto_retry_end` with `success: false`. pi exits 0. |
| `aborted.synthetic.jsonl` | **Hand-written**, not captured: pi exits on SIGTERM/SIGINT without writing an `aborted` message, so this follows the `AssistantMessage` shape in pi's `docs/message-types.md`. |

## Scrubbing

The captured streams are unchanged except for the system message (it appears
in `message_start`, `message_end` and `agent_end.messages`): each prompt
section's text is replaced with `[scrubbed]` and each `toolsAdded` entry is
reduced to its `name`. Those fields hold the capturing machine's skill list
and install paths, and nothing in PaF reads them. Record order, record count
and every other field are as pi wrote them.

The only filesystem paths left are under `/private/tmp/paf-pi-step0/`.

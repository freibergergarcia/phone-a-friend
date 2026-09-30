## Session continuity

If this relay is a follow-up to a previous `/phone-a-friend` relay in the
same conversation (e.g., user asked for a review, saw the feedback, and now
wants the same backend to apply fixes or dig deeper), reuse the session:

1. On the **first** relay in a conversation, generate a session ID:
   `paf-<backend>-<short-slug>-<4-char-random>` (e.g.,
   `paf-codex-auth-review-a3f2`). The random suffix prevents collisions
   across repos and conversations.
2. Add `--session <id>` to the relay command.
3. On **subsequent** relays to the **same backend** in the same
   conversation, reuse the same session ID. The backend remembers previous
   turns.
4. If switching backends (e.g., first call to codex, second to ollama),
   generate a new session ID for the new backend. Sessions are
   backend-specific.

Benefits: the backend keeps full conversation history, so follow-up prompts
can be shorter (no need to re-send context from previous turns).

For structured Codex follow-ups, keep passing the requested `--schema` with
`--session` or `--backend-session`. PaF probes resume support and fails clearly
when the selected CLI cannot accept it; never silently remove the schema.
Use `doctor --json` to diagnose PATH/version mismatches before retrying.

**Backend-specific behavior:**
- **Antigravity**: native session resume via `--session` or `--backend-session`.
- **pi**: native session resume via `--session`. PaF keeps pi sessions in its own
  directory and refuses to resume one whose file is missing, because pi would
  silently start a new session. `--backend-session` works only for a session PaF
  started; sessions created directly in pi cannot be attached.
- **Codex, Claude, OpenCode**: native session resume. Follow-up prompts
  can send deltas only.
- **Ollama**: replays full history each call. Sessions work but prompt
  size grows with each turn. Keep follow-ups concise.
- **Gemini**: native session resume (same as Codex/Claude/OpenCode).
  PaF generates the session UUID client-side, pins it with `--session-id`
  on the first call, and resumes with `--resume` later. Follow-up prompts
  can send deltas only.

On the FIRST relay under a new session label, PaF prints an informational
stderr line: `[phone-a-friend] Session label "..." not found in store.
Starting a fresh session under this label.` This is expected. The hint
about `--backend-session` in that line is for advanced use (see below)
and not relevant to the typical `/phone-a-friend` flow.

**Omit `--session`** for one-off relays where no follow-up is expected.
This is the common case. Only add `--session` when the user explicitly
asks for a follow-up or continuation of a previous relay.

Session continuity is only available in binary mode (`RELAY_MODE = binary`).

### Advanced: `--backend-session` (raw thread ID adoption)

If the user explicitly provides a Codex/Claude/OpenCode backend thread ID
that PaF did not create (e.g., from another tool or a previous CLI run),
attach to it with `--backend-session <id>` instead of `--session <id>`.
Combine with `--session <label>` to also start tracking under a label.

```bash
# Resume a raw backend thread once (no PaF persistence):
phone-a-friend --to codex --repo "$PWD" --backend-session <thread-id> --prompt "<...>" $PAF_NO_DIFF

# Adopt: resume AND start tracking under a PaF label going forward:
phone-a-friend --to codex --repo "$PWD" --session <label> --backend-session <thread-id> --prompt "<...>" $PAF_NO_DIFF
```

This is rarely the right move from inside a Claude Code conversation — the
common case is `--session <label>` with a fresh label. Only use
`--backend-session` when the user supplied a specific backend thread ID.

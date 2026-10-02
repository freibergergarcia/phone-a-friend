## Antigravity vs Gemini CLI

Use `--to antigravity` when the user has the Google Antigravity CLI (`agy`)
or a consumer Google subscription path. PaF invokes it in read-only plan
mode with `--sandbox --mode plan --add-dir "$PWD"`.

Use `--to gemini` for Gemini CLI flows that are still valid for the user
(API key, Vertex AI, or enterprise Gemini Code Assist). If Gemini CLI returns
"This client is no longer supported for Gemini Code Assist for individuals",
do not keep retrying Gemini OAuth; suggest Antigravity or API-key/Vertex
Gemini setup.

## Gemini model selection

By default, **omit `--model`** for `--to gemini` and let Gemini CLI's
auto-routing pick the model. This mirrors how `--to codex` and `--to claude`
work in this skill — the CLI's own default is the right default. Pinning
`--model` ages docs poorly; auto-routing tracks deployed models for you.

### When to pin `--model` explicitly

Set `--model` when you need:

- **Model selection** — request a specific model instead of CLI auto-routing;
  responses can still vary across runs.
- **Capability** — choose an available model suited to the task and your
  account limits.
- **Debugging** — isolating model behavior from auto-routing changes.

When you do pin and the model returns a strong 404 (`ModelNotFoundError`),
PaF caches the model as unavailable for 24h at
`~/.config/phone-a-friend/gemini-models.json` and surfaces a clear error
that includes the cache path, expiry timestamp, and bypass instructions.
PaF does **not** auto-substitute another model — explicit pins surface
explicit failures so the caller decides whether to retry, switch model,
or omit `--model` and rely on auto-routing.

To bypass the cache (debugging stale entries or testing recovery):

```bash
PHONE_A_FRIEND_GEMINI_DEAD_CACHE=false phone-a-friend --to gemini --model X --prompt "..."
```

Or delete `~/.config/phone-a-friend/gemini-models.json` to clear it.

### Cache scope

- **Cached** (24h): strong 404 (`ModelNotFoundError` from gemini-cli's own classifier).
- **Not cached**: ambiguous 404s (could be a missing project / file, not the model), 429 / RESOURCE_EXHAUSTED, authentication failures, any other error class.
- **Not consulted**: when `--model` is unset (auto-routing), or during session resume (`--resume`).

### Direct Gemini CLI mode (without `phone-a-friend --to gemini`)

When the orchestrator is calling `gemini` directly (no PaF wrapper), the
dead-model cache does NOT apply — the orchestrator is responsible for any
retry. In direct mode, retry rules:

- **Retry**: HTTP 429, 499, 500, 503, 504; RESOURCE_EXHAUSTED; transient/timeout errors.
- **Do NOT retry**: authentication failures, invalid arguments, permission errors, model-not-found.
- **Default**: if an error cannot be confidently classified as transient, surface it immediately.

This does NOT apply to `--to codex` or `--to claude`.

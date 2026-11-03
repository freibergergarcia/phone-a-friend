#!/bin/bash
# Live end-to-end probe of one phone-a-friend backend against a scratch config
# directory and a throwaway git repo. Used before merging backend changes.
#
#   scripts/probe-backends.sh <backend> [model]
#
# Runs, in order: one-shot relay, two-turn --session recall, --schema,
# --review, --verdict-json (plus --fast for opencode and pi), a --stream
# relay (backends without runStream fall back to batch inside the relay), a
# --quiet relay checked through `job result`, then `session list` and
# `task list`. Ollama needs OLLAMA_HOST in the environment; the backend
# reads it. Writes per-step stdout/stderr and a summary under
# a unique directory within $PAF_PROBE_OUT (default: system temp dir). Nothing touches
# ~/.config/phone-a-friend: XDG_CONFIG_HOME is scratch.
#
# A backend that needs config beyond --model gets it through
# PAF_PROBE_CONFIG, a TOML file copied into the scratch config directory:
#
#   printf '[backends.pi]\nprovider = "mlx"\n' > /tmp/pi.toml
#   PAF_PROBE_CONFIG=/tmp/pi.toml scripts/probe-backends.sh pi <model>
#
# Exit status is the number of failed steps. Every step runs even after a
# failure so the summary is complete; compare it against the baseline table
# in the PR, since a failing step may be a known backend limit rather than a
# regression.
# A zero exit requires semantic assertions as well as successful CLI exits.
# Raw stdout, stderr, and assertion diagnostics remain in the evidence directory.
# Parse the complete run before starting slow backend calls, so an edit to this
# script during development cannot change the commands of an in-flight probe.
main() {
set -eu
B=${1:?backend}; MODEL=${2:-}
case "$B" in
  antigravity|claude|codex|gemini|ollama|opencode|pi|grok|xai) ;;
  *) echo "Unknown backend: $B" >&2; exit 2 ;;
esac
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PAF=(node "$ROOT/dist/index.js")
mkdir -p "${PAF_PROBE_OUT:-${TMPDIR:-/tmp}}"
OUTROOT=$(mktemp -d "${PAF_PROBE_OUT:-${TMPDIR:-/tmp}}/paf-probe-$B.XXXXXX")
# Canonical paths matter for backend session identity on macOS (/tmp is a symlink).
OUTROOT=$(cd "$OUTROOT" && pwd -P)
export XDG_CONFIG_HOME="$OUTROOT/xdg-$B"; mkdir -p "$XDG_CONFIG_HOME"
export PHONE_A_FRIEND_UPDATE_CHECK=false
if [ -n "${PAF_PROBE_CONFIG:-}" ]; then
  mkdir -p "$XDG_CONFIG_HOME/phone-a-friend"
  cp "$PAF_PROBE_CONFIG" "$XDG_CONFIG_HOME/phone-a-friend/config.toml" || exit 99
fi
REPO="$OUTROOT/repo-$B"; mkdir -p "$REPO"; cd "$REPO"
git init -q -b main; git config user.email p@x; git config user.name p
printf 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n' > math.js
git add math.js; git commit -qm init
git checkout -qb feature
printf 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n' > math.js
git commit -qam "change add"
OUT="$OUTROOT/out-$B"; mkdir -p "$OUT"; : > "$OUT/summary.txt"
M=(); [ -n "$MODEL" ] && M=(--model "$MODEL")
FAILED=0
STREAM=--no-stream
echo "Evidence: $OUT"
record() {
  local name=$1 rc=$2 t0=$3
  local assertion=0
  node "$ROOT/scripts/assert-probe.mjs" "$name" "$OUT/$name.out" "$B" "$REPO" > "$OUT/$name.assert" 2>&1 || assertion=$?
  if [ "$rc" -ne 0 ] || [ "$assertion" -ne 0 ]; then FAILED=$((FAILED + 1)); fi
  printf '%s rc=%s assertion=%s t=%ss stdout=%sB\n' "$name" "$rc" "$assertion" "$(( $(date +%s) - t0 ))" "$(wc -c < "$OUT/$name.out" | tr -d ' ')" | tee -a "$OUT/summary.txt"
}
run() {
  local name=$1; shift
  local t0=$(date +%s)
  local rc=0
  printf '%q ' "${PAF[@]}" --to "$B" --repo "$REPO" --timeout "${PAF_PROBE_TIMEOUT:-120}" "$STREAM" ${M[@]+"${M[@]}"} "$@" > "$OUT/$name.command"
  "${PAF[@]}" --to "$B" --repo "$REPO" --timeout "${PAF_PROBE_TIMEOUT:-120}" "$STREAM" ${M[@]+"${M[@]}"} "$@" > "$OUT/$name.out" 2> "$OUT/$name.err" || rc=$?
  record "$name" "$rc" "$t0"
}
run oneshot --prompt "Reply with exactly the single word PONG and nothing else."
run sess1 --session probe --prompt "Remember the secret word MARMALADE. Reply with exactly OK."
run sess2 --session probe --prompt "What was the secret word I asked you to remember? Reply with just that word."
run schema --schema '{"type":"object","properties":{"ok":{"type":"boolean"},"word":{"type":"string"}},"required":["ok","word"],"additionalProperties":false}' --prompt "Return ok=true and word=PONG."
run review --review --base main
run verdict --review --base main --verdict-json
# OpenCode: --fast maps to --pure on 1.x and must be a no-op on 2.x.
# pi: --fast maps to -nc -ns (no context files, no skills).
case "$B" in
  opencode|pi) run fast --fast --prompt "Reply with exactly the single word PONG and nothing else." ;;
esac
STREAM=--stream
run stream --prompt "Reply with exactly the single word PONG and nothing else."
STREAM=--no-stream
run quiet --quiet --prompt "Reply with exactly the single word PONG and nothing else."
step() { # name, command...
  local name=$1; shift
  local t0=$(date +%s) rc=0
  printf '%q ' "$@" > "$OUT/$name.command"
  "$@" > "$OUT/$name.out" 2> "$OUT/$name.err" || rc=$?
  record "$name" "$rc" "$t0"
}
# --quiet prints "Job started <id>"; the stored result must hold the reply.
JOB=$(sed -n 's/.*Job started \([a-z0-9-]*\).*/\1/p' "$OUT/quiet.out" | head -1)
step job-result "${PAF[@]}" job result "${JOB:-missing}"
step session-list "${PAF[@]}" session list --json
step task-list "${PAF[@]}" task list --repo "$REPO" --json
echo "DONE $B failed=$FAILED" | tee -a "$OUT/summary.txt"
return "$FAILED"
}

main "$@"

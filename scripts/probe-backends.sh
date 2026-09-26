#!/bin/bash
# Live end-to-end probe of one phone-a-friend backend against a scratch config
# directory and a throwaway git repo. Used before merging backend changes.
#
#   scripts/probe-backends.sh <backend> [model]
#
# Runs, in order: one-shot relay, two-turn --session recall, --schema,
# --review, --verdict-json (plus --fast for opencode), a --stream relay
# (backends without runStream fall back to batch inside the relay), a
# --quiet relay checked through `job result`, then `session list` and
# `task list`. Ollama needs OLLAMA_HOST in the environment; the backend
# reads it. Writes per-step stdout/stderr and a summary under
# $PAF_PROBE_OUT (default: a temp dir). Nothing touches
# ~/.config/phone-a-friend: XDG_CONFIG_HOME is scratch.
#
# Exit status is the number of failed steps. Every step runs even after a
# failure so the summary is complete; compare it against the baseline table
# in the PR, since a failing step may be a known backend limit rather than a
# regression.
set -u
B=${1:?backend}; MODEL=${2:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PAF="node $ROOT/dist/index.js"
OUTROOT=${PAF_PROBE_OUT:-$(mktemp -d)}
export XDG_CONFIG_HOME="$OUTROOT/xdg-$B"; mkdir -p "$XDG_CONFIG_HOME"
REPO="$OUTROOT/repo-$B"; rm -rf "$REPO"; mkdir -p "$REPO"; cd "$REPO"
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
run() {
  local name=$1; shift
  local t0=$(date +%s)
  $PAF --to "$B" --repo "$REPO" --timeout "${PAF_PROBE_TIMEOUT:-120}" "$STREAM" ${M[@]+"${M[@]}"} "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"
  local rc=$?
  [ "$rc" -ne 0 ] && FAILED=$((FAILED + 1))
  printf '%s rc=%s t=%ss stdout=%sB | %s\n' "$name" "$rc" "$(( $(date +%s) - t0 ))" "$(wc -c < "$OUT/$name.out" | tr -d ' ')" "$(head -c 160 "$OUT/$name.out" | tr '\n' ' ')" >> "$OUT/summary.txt"
}
run oneshot --prompt "Reply with exactly the single word PONG and nothing else."
run sess1 --session probe --prompt "Remember the secret word MARMALADE. Reply with exactly OK."
run sess2 --session probe --prompt "What was the secret word I asked you to remember? Reply with just that word."
run schema --schema '{"type":"object","properties":{"ok":{"type":"boolean"},"word":{"type":"string"}},"required":["ok","word"],"additionalProperties":false}' --prompt "Return ok=true and word=PONG."
run review --review --base main
run verdict --review --base main --verdict-json
# OpenCode: --fast maps to --pure on 1.x and must be a no-op on 2.x.
[ "$B" = opencode ] && run fast --fast --prompt "Reply with exactly the single word PONG and nothing else."
STREAM=--stream
run stream --prompt "Reply with exactly the single word PONG and nothing else."
STREAM=--no-stream
run quiet --quiet --prompt "Reply with exactly the single word PONG and nothing else."
step() { # name, command...
  local name=$1; shift
  "$@" >> "$OUT/summary.txt" 2>&1
  local rc=$?
  [ "$rc" -ne 0 ] && FAILED=$((FAILED + 1))
  echo "$name rc=$rc" >> "$OUT/summary.txt"
}
# --quiet prints "Job started <id>"; the stored result must hold the reply.
JOB=$(sed -n 's/.*Job started \([a-z0-9-]*\).*/\1/p' "$OUT/quiet.out" | head -1)
$PAF job result "${JOB:-missing}" > "$OUT/job-result.out" 2>&1
if grep -q PONG "$OUT/job-result.out"; then echo "job-result rc=0 | $(head -c 80 "$OUT/job-result.out" | tr '\n' ' ')" >> "$OUT/summary.txt"
else echo "job-result rc=1 | $(head -c 160 "$OUT/job-result.out" | tr '\n' ' ')" >> "$OUT/summary.txt"; FAILED=$((FAILED + 1)); fi
step session-list $PAF session list
step task-list $PAF task list --repo "$REPO"
echo "DONE $B failed=$FAILED" >> "$OUT/summary.txt"
cat "$OUT/summary.txt"
exit "$FAILED"

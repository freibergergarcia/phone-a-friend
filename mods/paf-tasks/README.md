# paf-tasks: phone-a-friend, made legible

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview). When
Claude asks another model for a second opinion through phone-a-friend, this
shows what was asked, what the reviewer is doing, and what it said, in the
reviewer's own words.

## Install

It is a separate, optional plugin in the phone-a-friend marketplace:

```
/plugin marketplace add freibergergarcia/phone-a-friend   # skip if already added
/plugin install paf-tasks@phone-a-friend-marketplace
/reload-plugins
```

Requirements:

| Needs | Why |
|---|---|
| Claude Code 2.1.287 or newer | mods are on by default from that version (`claude --version`) |
| phone-a-friend 4.5.0 or newer on `PATH` | the panel reads `phone-a-friend task list --json --repo <worktree>` |
| herdr (optional) | the Agents tab lists herdr's agent sessions; without herdr the tab is hidden |

On a Claude Code without mods, this plugin fails to load (Claude Code reports
an invalid manifest) and the `phone-a-friend` plugin keeps working. A
phone-a-friend CLI that is missing or too old is named in the panel, with the
command that fixes it.

Update: `/plugin marketplace update phone-a-friend-marketplace`, then
`/plugin update paf-tasks@phone-a-friend-marketplace`. Its version follows
phone-a-friend releases. Remove: `/plugin uninstall paf-tasks@phone-a-friend-marketplace`,
or disable it in `/plugin` (Installed tab).
If `/plugin install` cannot find `paf-tasks`, the marketplace is probably
registered from an old folder: Claude Code keeps the first source of a
marketplace name. `phone-a-friend doctor` says so, and
`phone-a-friend plugin update --claude` (add `--force-marketplace-sync` when
doctor asks for it) repoints it and reinstalls what you had.

When `phone-a-friend plugin install --claude` registered the marketplace,
`phone-a-friend plugin uninstall --claude` removes the panel with it; a
marketplace you added yourself is left alone, panel included, unless you add
`--purge-marketplace`.

## What you see

**In the conversation.** A phone-a-friend call is drawn as a call instead of
"Ran 1 shell command":

    ⠹ codex · Round 3 · 00:42 · usually 1m 54s · git show 4f2a91c
    ✗ codex · Round 3 · 1 blocker · 1 important · 1m 52s
      blocker   README.md:600    The recovery note is wrong for pi. ...
      important src/cli.ts:344   installPath() still documents copy mode ...

`ctrl+o` still shows the command and its raw output, with the same line under
it. While the turn waits, its spinner says `Waiting on codex…`.

**In the panel** (`/paf`). Everything asked about one branch is one thread:

- the **trail**, one mark per round, oldest to newest (`✗ ✓ ✗ ✗ ✓`): whether the
  review is converging;
- the rounds, newest first, each with its verdict;
- the open round: what was asked, the findings with severity and location, or
  for a round still running, its steps and how long this usually takes;
- other branches of the same repository.

`2` switches to **Agents** (with herdr): the sessions herdr runs, grouped by
what needs you, with what each one's reviewer last said. Enter jumps to a session.

**Above the prompt**, one line while a reviewer works and the panel is not on
screen. A toast when a round finishes.

The panel opens by itself once the repository has reviews to show, and stays
closed once you close it, until you type `/paf`.

## Keys (panel focused: `/paf`, a click, or `ctrl+x tab`)

| Key | Does |
|---|---|
| `j` / `k` | older / newer round |
| `m` | more / fewer rounds |
| `f` | full answer / less |
| `s` | send the round's findings to Claude |
| `c` | copy the reviewer's answer |
| `b` | next branch |
| `w` | this worktree only / all worktrees |
| `r` | refresh now |
| `1` / `2` | Reviews / Agents |

`/paf agents`, `/paf reviews`, `/paf close`.

## Marks

| Mark | Means |
|---|---|
| `✓` green | ship: the reviewer said so, or had nothing to fix |
| `✗` red | findings, at least one blocker |
| `✗` yellow | findings, none a blocker |
| `·` gray | an answer that is not a review |
| `!` red | the call failed (the row says why, the round says what to do) |
| spinner | still running |

A verdict the reviewer declared ("VERDICT: ship", "Ship.") is shown in its word.
One read off the answer is shown as the facts: `3 findings`, `no findings`.

## Options (`/plugin` → paf-tasks, or `/config`)

| Option | Values | Default |
|---|---|---|
| `panel` | `both`, `calls`, `agents` | `both` |
| `auto_open` | open the panel once there are reviews to show | `true` |
| `band` | `auto` (only while the panel is hidden), `always`, `never` | `auto` |
| `transcript` | draw calls in the conversation | `true` |

## What it reads

- `git worktree list` for the session's repository, then
  `phone-a-friend task list --json --repo <worktree>` for each worktree, and
  `task show <id> --json` for a running task. It never lists the whole task
  store, so another repository's records are not read. Before and after each
  listing, `git rev-parse --git-common-dir` confirms the path still belongs to
  this repository; outside git, or when that cannot be confirmed, nothing is
  listed and the panel is cleared.
- `herdr agent list` and `herdr workspace list` for the Agents tab (once a
  minute when herdr is not installed). Session titles are drawn on screen
  only; nothing from them is sent to Claude.

It writes nothing outside Claude Code's own state, and "Send to Claude" is the
only thing that puts text into the conversation.

## Development

```bash
claude --plugin-dir mods/paf-tasks          # load this checkout's copy for one session
claude plugin validate --strict mods/paf-tasks
claude plugin test mods/paf-tasks
```

Loading the folder makes Claude Code write its type declarations to
`.claude-plugin/types/` here (ignored by git); `tsc -p mods/paf-tasks` then
type-checks the mod. CI runs the validate and test commands with a pinned
Claude Code version.

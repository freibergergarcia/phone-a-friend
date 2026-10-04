import { expect, test } from 'claude-code/testing'

import { answerIn, cleanActivity, lede, parseRelay, parseWorktrees, rootOf, roundOfCall, taskOfCall, verdictText } from '../hooks/format'
import {
  countsText,
  explain,
  handoff,
  isSelf,
  parseAnswer,
  placeOf,
  questionOf,
  roundOf,
  titleOf,
  toAgentCards,
  toRound,
  toThreads,
  usualMs,
} from '../hooks/model'
import { CODEX, ELSEWHERE, LIVE, LOST, PORCELAIN, QUIET, REVISE, ROOT, SHIP, task } from './fixtures'

test('a declared verdict is taken in the reviewer’s word, with its tagged findings', async () => {
  const revise = parseAnswer(REVISE.result)
  expect(revise.verdict).toBe('revise')
  expect(revise.source).toBe('declared')
  expect(revise.findings.map(finding => [finding.severity, finding.location])).toEqual([
    ['important', 'src/installer.ts:80'],
    ['nit', 'tests/installer.test.ts:412-430'],
  ])
  expect(revise.findings[0]?.text).toStartWith('Pi accepts `git:github.com:owner/phone-a-friend`')

  const ship = parseAnswer(SHIP.result)
  expect([ship.verdict, ship.source, ship.findings.length]).toEqual(['ship', 'declared', 0])
  expect(ship.summary).toStartWith('No findings.')
})

test('Codex’s own review reads as findings: P-levels, linked locations, detail under a finding', async () => {
  const answer = parseAnswer(CODEX.result, 'diff')
  expect([answer.verdict, answer.source]).toEqual(['revise', 'inferred'])
  expect(answer.findings.map(finding => [finding.severity, finding.location])).toEqual([
    ['blocker', 'installer.ts:843'],
    ['important', 'detection.ts:212'],
    ['important', 'installer.ts:414'],
  ])
  expect(answer.findings[0]?.text).toContain('installer.ts:843 removes the directory')
  expect(answer.findings[0]?.detail).toStartWith('Scenario: create the skill by hand')
  expect(answer.summary).toBe('No on-wire or session-store issue found.')
})

test('answers that say there is nothing to fix are a ship, read off the answer', async () => {
  for (const text of [
    'No real defects.',
    'Clean — no correctness regressions found in `db77b08`.',
    'I found no hard violation in the diff.',
    'Both findings are resolved. Nothing further.',
  ]) {
    const answer = parseAnswer(text)
    expect([text, answer.verdict, answer.source, answer.findings.length]).toEqual([text, 'ship', 'inferred', 0])
  }
  // "Ship." is the reviewer saying it.
  expect(parseAnswer('Ship. The prior finding is resolved: wording matches.').source).toBe('declared')
  // A clean opening that turns is not clean.
  expect(parseAnswer('No blockers, but two issues remain:\n\n- P2 — the cache is never cleared.').verdict).toBe('revise')
})

test('bold leads, inline leads and the verdict envelope are all understood', async () => {
  const bold = parseAnswer('**Hard standards violation — [db.ts](/abs/src/db.ts:361).** The query is built by string concatenation.')
  expect(bold.findings).toHaveLength(1)
  expect([bold.findings[0]?.severity, bold.findings[0]?.location]).toEqual(['blocker', 'db.ts:361'])

  const inline = parseAnswer('One blocker: the marker is written before the copy completes.')
  expect([inline.verdict, inline.findings[0]?.severity]).toEqual(['revise', 'blocker'])
  // A negated lead is not a finding.
  expect(parseAnswer('I found no defect: the patch is sound.').findings).toHaveLength(0)

  const envelope = parseAnswer(
    JSON.stringify({
      schema_version: 1,
      verdict: 'iterate',
      summary: 'Two problems.',
      findings: [
        { severity: 'blocker', title: 'Refresh can run twice', rationale: 'inFlight is reset too early.', location: 'hooks/register.tsx:132' },
        { severity: 'nit', title: 'Toast repeats the id', rationale: 'The id is in the pane.', location: null },
      ],
    }),
  )
  expect([envelope.verdict, envelope.source, envelope.findings.length]).toEqual(['revise', 'json', 2])
  expect(envelope.findings[0]).toEqual({ severity: 'blocker', location: 'hooks/register.tsx:132', text: 'Refresh can run twice', detail: 'inFlight is reset too early.' })
})

test('only nits is a ship; a plan or an essay is not a review', async () => {
  const nits = parseAnswer('- [nit] [README.md:10] — typo\n- [nit] wording could be tighter')
  expect([nits.verdict, nits.source, nits.findings.length]).toEqual(['ship', 'inferred', 2])

  const essay = ['Plan:', ...Array.from({ length: 14 }, (_item, index) => `- step ${index + 1}: do the next thing`)].join('\n')
  const plan = parseAnswer(essay, 'diff')
  expect([plan.verdict, plan.findings.length]).toEqual(['none', 0])

  // A question answered in prose is neither.
  const prose = parseAnswer('Yes. In headless mode shell commands are auto-denied.', 'other')
  expect([prose.verdict, prose.findings.length]).toEqual(['none', 0])
})

test('a failure is named, and a known one says what to do', async () => {
  const lost = explain(LOST.error, 'failed')
  expect(lost?.label).toBe('session lost')
  expect(lost?.line).toStartWith('thread/resume: thread/resume failed: no rollout found')
  expect(lost?.hint).toContain('new --session label')

  expect(explain('claude timed out after 60s', 'failed')?.label).toBe('timed out')
  expect(explain('Git diff is too large (312122 bytes; max 300000 bytes)', 'failed')?.label).toBe('diff too large')
  expect(explain(null, 'interrupted')).toEqual({ label: 'interrupted', line: 'Interrupted before it finished.', hint: null })
  expect(explain('anything', 'completed')).toBeNull()
})

test('route folders are part of a location, and a single defect told as prose is a finding', async () => {
  // Answers of the shape that read as no findings before.
  const route = parseAnswer('Task B — new defects only\n\n1. `src/app/(shop)/checkout/page.tsx:12` — A paid order still exposes the full `EditSurface`.', 'review')
  expect(route.findings.map(finding => [finding.location, finding.text])).toEqual([
    ['src/app/(shop)/checkout/page.tsx:12', 'A paid order still exposes the full `EditSurface`.'],
  ])
  expect(route.verdict).toBe('revise')
  expect(parseAnswer('- `app/[id]/[...slug]/page.tsx:3` — the param is not decoded.', 'review').findings[0]?.location).toBe('app/[id]/[...slug]/page.tsx:3')
  // A bracket or parenthesis around a path is not part of it.
  expect(parseAnswer('One issue: the retry never stops (see src/retry.ts:40).', 'review').findings[0]?.location).toBe('src/retry.ts:40')

  const prose = parseAnswer(
    "The single most likely correctness bug is that the parser overly restricts the length of the worker's final output.\n\n**Location:** Line 485 in `Frame::Result` parsing.\n\nRaise the cap or stream the rest.",
    'review',
  )
  expect(prose.findings.map(finding => [finding.severity, finding.location])).toEqual([['finding', 'Line 485 in `Frame::Result` parsing']])
  expect(prose.findings[0]?.text).toStartWith("the parser overly restricts the length of the worker's final output")
  expect(prose.verdict).toBe('revise')
  // Not every "the issue is that" is a review: outside a review ask it stays prose.
  expect(parseAnswer('The main issue is that nobody owns the queue.', 'other').findings).toEqual([])
})

test('a round is titled by how its prompt opens', async () => {
  expect(titleOf('Round 3 for #400. Fixed: the anchor now matches a whole clause.', 'relay', null, 'codex')).toBe('Round 3 for #400')
  expect(titleOf('Gate B, pass 2. Delta only: one commit.', 'relay', null, 'codex')).toBe('Gate B, pass 2')
  expect(titleOf('Delta after your ship at b86b56f. One new commit.', 'relay', null, 'codex')).toBe('Delta after your ship at b86b56f')
  expect(titleOf('', 'review', 'working-tree', 'codex')).toBe('Working tree review')
  expect(titleOf('Review the changes on this branch for correctness bugs.', 'review', 'branch', 'codex')).toBe('Branch review')
  expect(titleOf('', 'relay', null, 'gemini')).toBe('gemini relay')
  expect(titleOf('ROUND 3 — final sign-off on the parser', 'relay', null, 'codex')).toBe('Round 3')

  // What was asked beyond the title.
  expect(questionOf(toRound(REVISE))).toBe('One new commit, 6c72744. Your finding on the :443 host form is fixed.')
  expect(questionOf(toRound(task({ id: 'r1', kind: 'review', promptPreview: '' }, 10, 5)))).toBe('')
})

test('everything asked about one branch is one thread, oldest round first, a live one leading', async () => {
  const threads = toThreads([LIVE, CODEX, LOST, SHIP, REVISE, ELSEWHERE])
  expect(threads.map(thread => [thread.title, thread.rounds.length, thread.state])).toEqual([
    ['feat/pi-backend', 5, 'live'],
    ['chore/plugin-directory-readiness', 1, 'ship'],
  ])
  const first = threads[0]
  expect(first?.rounds.map(round => round.task.id)).toEqual(['d26a67ed', 'b2d2d470', '4be0c1d9', '4dba04f2', 'a81f03c2'])
  expect(first?.rounds.map(round => round.state)).toEqual(['revise', 'ship', 'failed', 'revise', 'live'])
  expect(first?.backends).toEqual(['codex'])
  expect(first?.labels).toEqual(['pi-impl'])
})

test('a worktree path names its repository and its worktree', async () => {
  expect(placeOf('/home/me/.herdr/worktrees/phone-a-friend/worktree-green-river-fb03')).toEqual({ repo: 'phone-a-friend', worktree: 'green-river' })
  expect(placeOf('/home/me/conductor/workspaces/phone-a-friend/memphis')).toEqual({ repo: 'phone-a-friend', worktree: 'memphis' })
  expect(placeOf('/home/me/dev/phone-a-friend/.claude/worktrees/fix-auth')).toEqual({ repo: 'phone-a-friend', worktree: 'fix-auth' })
  expect(placeOf('/home/me/dev/phone-a-friend')).toEqual({ repo: 'phone-a-friend', worktree: null })
  expect(placeOf(null)).toEqual({ repo: 'unknown', worktree: null })
})

test('git’s worktree list gives the roots to ask about; gone ones are skipped', async () => {
  const roots = parseWorktrees(PORCELAIN)
  expect(roots).toEqual([ROOT, QUIET])
  expect(rootOf(`${ROOT}/src/backends`, roots)).toBe(ROOT)
  expect(rootOf(QUIET, roots)).toBe(QUIET)
  expect(rootOf('/somewhere/else', roots)).toBeNull()
  // A worktree inside another resolves to the deeper one.
  expect(rootOf('/work/paf/.claude/worktrees/x/src', ['/work/paf', '/work/paf/.claude/worktrees/x'])).toBe('/work/paf/.claude/worktrees/x')
})

test('a Bash command is read as a relay only when it is one', async () => {
  const plain = parseRelay('phone-a-friend --to codex --repo . --session pr180-review --prompt "Round 3. I pushed fa87eb2."')
  expect(plain).toEqual({ backend: 'codex', label: 'pr180-review', prompt: 'Round 3. I pushed fa87eb2.', isReview: false, scope: null, isOnlyCall: true, title: 'Round 3' })

  const piped = parseRelay(`cd /work/paf && PHONE_A_FRIEND_INCLUDE_DIFF=false phone-a-friend --to codex --repo . --no-include-diff --prompt 'Pass 2: it''s fixed' 2>&1 | tail -40`)
  expect([piped?.backend, piped?.isOnlyCall, piped?.title]).toEqual(['codex', true, 'Pass 2'])

  const review = parseRelay('phone-a-friend --to codex --review --review-scope working-tree --verdict-json')
  expect([review?.isReview, review?.scope, review?.title]).toEqual([true, 'working-tree', 'Working tree review'])

  const chained = parseRelay('npm run build && phone-a-friend --to gemini --prompt "Check the build output" && echo done')
  expect([chained?.backend, chained?.isOnlyCall]).toEqual(['gemini', false])
  expect(parseRelay('phone-a-friend --to codex --prompt "$(cat <<\'EOF\'\nRound 9\nEOF\n)"')?.isOnlyCall).toBe(false)

  for (const not of [
    'phone-a-friend task list --json --repo .',
    'phone-a-friend task show a81f03c2',
    'phone-a-friend doctor --json',
    'phone-a-friend --version',
    'phone-a-friend --to codex --prompt "x" --quiet',
    'npm install -g @freibergergarcia/phone-a-friend',
    'rg -n "phone-a-friend" README.md',
    'git status --short',
  ]) {
    expect([not, parseRelay(not)]).toEqual([not, null])
  }
})

test('a tool call finds its task: named in the output, or the live one with its prompt', async () => {
  const call = parseRelay(`phone-a-friend --to codex --session pi-impl --prompt '${LIVE.promptPreview}'`)
  if (call === null) throw new Error('not a relay')
  const tasks = [LIVE, SHIP, REVISE]

  // Still running: only a task still running can be it.
  expect(taskOfCall(call, null, false, tasks)?.id).toBe('a81f03c2')
  expect(taskOfCall(call, null, false, [SHIP, REVISE])).toBeNull()
  // Finished: the id PaF printed.
  expect(taskOfCall(call, 'Task b2d2d470 started\nVERDICT: ship\n◇ Task b2d2d470 completed · 23s', false, tasks)?.id).toBe('b2d2d470')
  // Finished with no id in what was printed: nothing is guessed.
  expect(taskOfCall(call, 'VERDICT: ship', false, tasks)).toBeNull()

  // Calls that asked the same thing take one task each, in the order they began.
  const began = Date.parse(LIVE.startedAt ?? '')
  const pair = (gap: number, a: number, b: number): (string | undefined)[] => {
    const tasks = [
      { ...LIVE, id: 'a81f03c9', startedAt: new Date(began + b).toISOString() },
      { ...LIVE, startedAt: new Date(began + a).toISOString() },
    ]
    const one = { id: 'call-1', at: began }
    const two = { id: 'call-2', at: began + gap }
    return [taskOfCall(call, null, false, tasks, { ...one, twins: [two] })?.id, taskOfCall(call, null, false, tasks, { ...two, twins: [one] })?.id]
  }
  // A minute and a half apart; two seconds apart (the earlier task is within the later call's slack);
  // 200 ms apart, each task 100 ms after its call; 100 ms apart with both tasks after both calls.
  expect(pair(89_000, 0, 90_000)).toEqual(['a81f03c2', 'a81f03c9'])
  expect(pair(2_000, 500, 2_500)).toEqual(['a81f03c2', 'a81f03c9'])
  expect(pair(200, 100, 300)).toEqual(['a81f03c2', 'a81f03c9'])
  expect(pair(100, 500, 600)).toEqual(['a81f03c2', 'a81f03c9'])
  // Only one task yet: the call that began first has it, the other is still starting.
  expect(taskOfCall(call, null, false, [LIVE], { id: 'call-2', at: began - 50, twins: [{ id: 'call-1', at: began - 100 }] })).toBeNull()
  // A twin that failed before making a task holds nothing; one that printed its task holds that one.
  expect(taskOfCall(call, null, false, [LIVE], { id: 'call-2', at: began - 50, twins: [{ id: 'call-1', at: began - 100, task: null }] })?.id).toBe('a81f03c2')
  const both = [{ ...LIVE, id: 'a81f03c9', startedAt: new Date(began + 600).toISOString() }, { ...LIVE, startedAt: new Date(began + 500).toISOString() }]
  expect(taskOfCall(call, null, false, both, { id: 'call-1', at: began, twins: [{ id: 'call-2', at: began + 100, task: 'a81f03c2' }] })?.id).toBe('a81f03c9')
  // Beside a background twin, which may have failed before making a task, neither row guesses.
  expect(taskOfCall(call, null, false, [LIVE], { id: 'call-2', at: began - 50, twins: [{ id: 'call-1', at: began - 100, isBackground: true }] })).toBeNull()
  expect(taskOfCall(call, null, false, [LIVE], { id: 'call-2', at: began - 50, isBackground: true, twins: [{ id: 'call-1', at: began - 100 }] })).toBeNull()
  // A task that started before the background twin did cannot be the twin's.
  expect(taskOfCall(call, null, false, [{ ...LIVE, startedAt: new Date(began + 1_000).toISOString() }], { id: 'call-1', at: began, twins: [{ id: 'call-2', at: began + 59_000, isBackground: true }] })?.id).toBe('a81f03c2')
  // Begun in the same millisecond: neither row guesses.
  expect(taskOfCall(call, null, false, both, { id: 'call-1', at: began, twins: [{ id: 'call-2', at: began }] })).toBeNull()
  // A call alone takes the only task near it, even one stamped a moment before it (clocks round).
  expect(taskOfCall(call, null, false, [LIVE], { id: 'call-1', at: began + 200, twins: [] })?.id).toBe('a81f03c2')
  // Without a start time, two live matches are not told apart.
  expect(taskOfCall(call, null, false, [{ ...LIVE, id: 'a81f03c9' }, LIVE])).toBeNull()

  const running = roundOfCall(call, { isRunning: true, isErrored: false, isInterrupted: false }, tasks)
  expect([running.task?.id, running.round?.state]).toEqual(['a81f03c2', 'live'])

  // No record (task history off): the round is read off what the command printed.
  const printed = roundOfCall(
    call,
    { isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: '◇ 00:04 Running: git diff\nFound two defects:\n\n- P1 — the note is wrong for pi.\n- P2 — the default is stale.\n', stderr: '' } },
    [],
  )
  expect([printed.task, printed.round?.state, printed.round?.answer.findings.length]).toEqual([null, 'revise', 2])

  const failed = roundOfCall(call, { isRunning: false, isErrored: true, isInterrupted: false, output: 'Error: thread/resume failed: no rollout found for thread id 01a0' }, [])
  expect([failed.round?.state, failed.round?.problem?.label]).toEqual(['failed', 'session lost'])

  // In the background: live once the panel has the task, unknown before.
  const background = { isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: 'Command running in background with ID: bash_1', stderr: '', backgroundTaskId: 'bash_1' } }
  expect(roundOfCall(call, background, tasks).round?.state).toBe('live')
  expect(roundOfCall(call, background, []).round).toBeNull()
  expect(roundOfCall(call, { isRunning: false, isErrored: false, isInterrupted: true, output: 'Interrupted' }, []).round).toBeNull()
})

test('rows say the facts: counts for a revise, "ship" only when the reviewer said it', async () => {
  expect(verdictText(roundOf(REVISE))).toBe('1 important · 1 nit')
  expect(verdictText(roundOf(SHIP))).toBe('ship')
  expect(verdictText(roundOf(CODEX))).toBe('1 blocker · 2 important')
  expect(verdictText(roundOf(ELSEWHERE))).toBe('ship')
  expect(verdictText(roundOf(LOST))).toBe('session lost')
  expect(verdictText(roundOf(LIVE))).toBe('reviewing')
  expect(verdictText(toRound(task({ id: 'c1', result: 'No real defects.' }, 100, 10)))).toBe('no findings')
  expect(verdictText(toRound(task({ id: 'q1', sessionLabel: null, promptPreview: 'Is 2+2=4?', result: 'Yes' }, 100, 10)))).toBe('answered')
  expect(countsText(parseAnswer(CODEX.result).findings)).toBe('1 blocker · 2 important')
})

test('small things: the answer inside PaF’s output, steps without the shell wrapper, a lede that closes its code span', async () => {
  expect(answerIn('Task a81f03c2 started · phone-a-friend task show a81f03c2\n◇ 00:04 Running: git diff\nShip. Nothing left.\n◇ Task a81f03c2 completed · 12s · scope unchanged')).toBe('Ship. Nothing left.')
  expect(cleanActivity(`Running: /bin/zsh -lc "rtk rg -n -i 'gemini|yolo' src"`)).toBe(`rg -n -i 'gemini|yolo' src`)
  expect(lede('Short.', 40)).toBe('Short.')
  expect(lede('The call to `installPath()` still documents copy mode as the default here', 30)).toBe('The call to `installPath()` …')
})

test('the usual duration is the median of finished calls like this one, once there are three', async () => {
  const done = [60, 100, 300].map((seconds, index) => task({ id: `u${index}` }, 1_000 * (index + 1), seconds))
  expect(usualMs(done, LIVE)).toBe(100_000)
  expect(usualMs(done.slice(0, 2), LIVE)).toBeNull()
  expect(usualMs(done, { ...LIVE, backend: 'gemini' })).toBeNull()
})

test('the handoff gives Claude the findings and asks for each to be checked', async () => {
  const thread = toThreads([REVISE, SHIP])[0]
  const round = thread?.rounds[0]
  if (!thread || !round) throw new Error('no thread')
  const text = handoff(thread, round)
  expect(text).toStartWith('phone-a-friend: codex answered "Pass 5 on the pi host work" (feat/pi-backend, round 1, task d26a67ed).')
  expect(text).toContain('Verdict: revise.')
  expect(text).toContain('- [important] [src/installer.ts:80] Pi accepts')
  expect(text).toEndWith('Check each finding against the code before acting on it, then fix the ones that hold.')
})

test('agent cards put what needs the person first, and know this session by its pane', async () => {
  const agent = (id: string, status: string, cwd: string, number: number) => ({ id, agent: 'claude', status, cwd, title: `✳ topic ${id}`, isFocused: false, number, repo: 'paf', workspace: null })
  const agents = [agent('w1:p1', 'idle', '/work/a', 1), agent('w3:p1', 'working', `${ROOT}/src`, 3), agent('w3:p2', 'idle', ROOT, 3), agent('w4:p1', 'blocked', '/work/b', 4), agent('w5:p1', 'done', QUIET, 5)]

  const byPane = toAgentCards(agents, { 'w4:p1': 1 }, { root: ROOT, pane: 'w3:p1' })
  expect(byPane.map(card => [card.agent.id, card.state, card.isHere])).toEqual([
    ['w4:p1', 'blocked', false],
    ['w5:p1', 'done', false],
    ['w3:p1', 'working', true],
    ['w1:p1', 'idle', false],
    ['w3:p2', 'idle', false],
  ])
  expect(byPane[0]?.topic).toBe('topic w4:p1')
  expect(byPane[0]?.since).toBe(1)

  // Without herdr's pane id, every session in this worktree counts as here.
  const byPath = { root: ROOT, pane: null }
  expect(agents.filter(item => isSelf(item, byPath)).map(item => item.id)).toEqual(['w3:p1', 'w3:p2'])
})

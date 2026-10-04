import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { PafTask } from '../types'
import { AGENTS, CODEX, ELSEWHERE, EVENTS, LIVE, LOST, NOW, PORCELAIN, QUIET, REVISE, ROOT, SHIP, WORKSPACES, task } from './fixtures'

const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

type World = {
  tasks: PafTask[]
  // 'missing': herdr cannot be run here. `pafError`: what `phone-a-friend` fails with.
  herdr?: 'missing'
  pafError?: string
  isPlaced?: boolean
  // Paths that, by the time they are asked about, hold another repository.
  foreign?: string[]
  // git lists the worktrees but cannot say which repository they belong to.
  isCommonUnreadable?: boolean
  // Not a git repository at all.
  isNotRepo?: boolean
}

// The host beneath the mod: git, phone-a-friend and herdr answered from `world`,
// which a test may change between polls. Returns every command that was run.
function host(on: On, world: World): { runs: string[][]; toasts: string[]; copied: string[]; submitted: string[] } {
  const seen = { runs: [] as string[][], toasts: [] as string[], copied: [] as string[], submitted: [] as string[] }
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    seen.runs.push(argv)
    if (argv[0] === 'git' && world.isNotRepo) return ran('', 128, 'fatal: not a git repository (or any of the parent directories): .git')
    if (argv[0] === 'git' && argv.includes('rev-parse')) {
      if (world.isCommonUnreadable) return ran('', 128, 'fatal: not a git repository')
      return ran(world.foreign?.includes(argv[2] ?? '') ? '/elsewhere/other-repo/.git\n' : `${ROOT}/.git\n`)
    }
    if (argv[0] === 'git') return ran(PORCELAIN)
    if (argv[0] === 'herdr') {
      if (world.herdr === 'missing') return ran('', 127, 'env: node: No such file or directory')
      if (argv[1] === 'agent' && argv[2] === 'list') return ran(JSON.stringify(AGENTS))
      if (argv[1] === 'workspace') return ran(JSON.stringify(WORKSPACES))
      return ran('')
    }
    if (world.pafError) return ran('', 1, world.pafError)
    if (argv[2] === 'show') return ran(JSON.stringify({ task: world.tasks.find(item => item.id === argv[3]), events: EVENTS }))
    const repo = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : null
    return ran(JSON.stringify(world.tasks.filter(item => repo === null || item.repoPath === repo)))
  })
  on('ui.open', async () => ({ value: world.isPlaced === false ? { isPlaced: false, reason: 'the terminal is too narrow' } : { isPlaced: true } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({
    value: [{ id: 'paf-tasks', title: 'phone-a-friend', isShown: true, isFocused: false, isPlaced: world.isPlaced !== false }],
  }))
  on('session.cwd', async () => ({ value: `${ROOT}/src` }))
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', async (_$, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.submit', async (_$, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  mock.env(on, { HERDR_PANE_ID: 'w3:p1' })
  return seen
}

const paf = (args = '') => ({ command: 'paf', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as const

const PANE = {
  component: 'Pane',
  requestId: 'paf-tasks',
  props: { title: 'phone-a-friend', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const SURFACES = ['terminal', 'desktop'] as const

test('the panel shows the thread for this branch: its trail, its rounds, and what the reviewer found', async ($, on) => {
  mock.clock(on, { now: NOW })
  host(on, { tasks: [CODEX, LOST, SHIP, REVISE, ELSEWHERE] })
  await $.command.run(paf())

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'paf-tasks', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: 'feat/pi-backend' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /codex · 4 rounds over 2h/ })).toBeDefined()
    // Oldest to newest: revise, ship, failed, revise.
    expect((await ui.find({ type: 'Text', text: /^✗ ✓ ! ✗$/ }))?.text).toBe('✗ ✓ ! ✗')

    // The newest round is open: Codex's three findings, worst first as it wrote them.
    expect((await ui.find({ key: 'round-4dba04f2' }))?.props.label).toBe('Review this branch (pi host slice)')
    expect(await ui.find({ type: 'Text', text: /^1 blocker · 2 important$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /branch vs origin\/main · 14 files · tree changed during review/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /A copied skill without the marker is deleted on uninstall/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^(blocker|important)$/ })).toHaveLength(3)
    // A finding that opens with code is left as written.
    expect(await ui.find({ type: 'Markdown', text: /^`piAgentDir\(\)` does not expand/ })).toBeDefined()

    // The other branch of this repository is one press away.
    expect((await ui.find({ key: 'thread-paf-quiet:chore/plugin-directory-readiness' }))?.props.label).toBe('chore/plugin-directory-readiness')
    await ui.unmount()
  }
})

test('pressing a round opens it; a failure says what happened and what to do', async ($, on) => {
  mock.clock(on, { now: NOW })
  host(on, { tasks: [CODEX, LOST, SHIP, REVISE] })
  await $.command.run(paf())

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'paf-tasks', surface, ...PANE })
    await ui.press({ key: 'round-4be0c1d9' })
    expect(await ui.find({ type: 'Text', text: /no rollout found for thread id/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Start the next round under a new --session label/ })).toBeDefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()

    // j and k walk the rounds: older from the failure is the ship.
    await ui.press({ key: 'older' })
    expect(await ui.find({ type: 'Markdown', text: /^No findings\. The git-source false negative is documented/ })).toBeDefined()
    await ui.press({ key: 'newer' })
    await ui.press({ key: 'newer' })
    expect(await ui.find({ type: 'Markdown', text: /A copied skill without the marker/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Send to Claude hands over the findings, Copy the answer, Full answer the detail', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = host(on, { tasks: [CODEX, SHIP] })
  await $.command.run(paf())

  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Markdown', text: /Scenario: create the skill by hand/ })).toBeUndefined()
  await ui.press({ key: 'full' })
  expect(await ui.find({ type: 'Markdown', text: /Scenario: create the skill by hand/ })).toBeDefined()
  expect((await ui.find({ key: 'full' }))?.props.label).toBe('Less')

  await ui.press({ key: 'copy' })
  await ui.press({ key: 'send' })
  await ui.unmount()

  expect(seen.copied).toEqual([CODEX.result])
  expect(seen.submitted).toHaveLength(1)
  expect(seen.submitted[0]).toStartWith('phone-a-friend: codex answered "Review this branch (pi host slice)" (feat/pi-backend, round 2, task 4dba04f2).')
  expect(seen.submitted[0]).toContain('- [blocker] [installer.ts:843] a copied skill without the marker')
  // Read off the answer, so no verdict is put in the reviewer's mouth.
  expect(seen.submitted[0]?.includes('Verdict:')).toBe(false)
})

test('PaF is asked about each worktree of this repository by path, never for its whole store', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = host(on, { tasks: [SHIP, ELSEWHERE] })
  await $.command.run(paf())

  const lists = seen.runs.filter(argv => argv[0] === 'phone-a-friend' && argv[2] === 'list')
  expect(lists.length).toBeGreaterThan(0)
  expect(lists.every(argv => argv.includes('--repo'))).toBe(true)
  // The session sits in a folder of its worktree; the gone worktree is not asked about.
  expect([...new Set(lists.map(argv => argv[argv.indexOf('--repo') + 1]))].sort()).toEqual([ROOT, QUIET])
  expect(seen.runs.find(argv => argv[0] === 'git')).toEqual(['git', '-C', `${ROOT}/src`, 'worktree', 'list', '--porcelain'])

  // "this worktree only" drops the other worktree's thread and stops asking about it.
  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'thread-paf-quiet:chore/plugin-directory-readiness' })).toBeDefined()
  const before = seen.runs.length
  await ui.press({ key: 'scope' })
  expect(await ui.find({ key: 'thread-paf-quiet:chore/plugin-directory-readiness' })).toBeUndefined()
  expect((await ui.find({ key: 'scope' }))?.props.label).toBe('all worktrees')
  expect(seen.runs.slice(before).filter(argv => argv.includes(QUIET))).toEqual([])
  await ui.unmount()
})

test('a listed worktree path that now holds another repository is not asked about', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = host(on, { tasks: [SHIP, ELSEWHERE], foreign: [QUIET] })
  await $.command.run(paf())

  const lists = seen.runs.filter(argv => argv[0] === 'phone-a-friend' && argv[2] === 'list')
  expect(lists.map(argv => argv[argv.indexOf('--repo') + 1])).toEqual([ROOT])
  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'thread-paf-quiet:chore/plugin-directory-readiness' })).toBeUndefined()
  await ui.unmount()
})

test('this worktree is re-checked before every listing: a path that changed repository is not read', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = { tasks: [SHIP, ELSEWHERE] }
  const seen = host(on, world)
  await $.command.run(paf())
  const listed = () => seen.runs.filter(argv => argv[2] === 'list' && argv.includes(ROOT)).length
  const before = listed()
  expect(before).toBeGreaterThan(0)

  const shown = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await shown.find({ key: 'send' })).toBeDefined()
  await shown.unmount()

  // Within the minute git's list is kept, the folder now holds another repository.
  world.foreign = [ROOT]
  await clock.advance(2_000)
  await $.command.run(paf())
  expect(listed()).toBe(before)
  // What was shown for it is gone too: nothing of it can be read or sent.
  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /changed repository/ })).toBeDefined()
  expect(await ui.find({ key: 'round-b2d2d470' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  await ui.unmount()
})

test('when git cannot say which repository this is, or there is no repository, nothing is listed', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world: World = { tasks: [SHIP, ELSEWHERE], isCommonUnreadable: true }
  const seen = host(on, world)
  await $.command.run(paf())

  const lists = () => seen.runs.filter(argv => argv[0] === 'phone-a-friend' && argv[2] === 'list')
  expect(lists()).toEqual([])
  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'round-b2d2d470' })).toBeUndefined()
  await ui.unmount()

  world.isCommonUnreadable = false
  world.isNotRepo = true
  await $.command.run(paf())
  expect(lists()).toEqual([])
  const bare = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await bare.find({ type: 'Text', text: /Not a git repository/ })).toBeDefined()
  await bare.unmount()
})

test('a live round shows what the reviewer is doing and how long it usually takes', async ($, on) => {
  mock.clock(on, { now: NOW })
  const usual = [60, 100, 300].map((seconds, index) => task({ id: `u000000${index}`, promptPreview: `Pass ${index + 1} on the pi host work.` }, 4_000 * (index + 1), seconds))
  host(on, { tasks: [LIVE, ...usual] })
  await $.command.run(paf())

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'paf-tasks', surface, ...PANE })
    expect((await ui.find({ key: 'round-a81f03c2' }))?.props.label).toBe('Pass 7 on the pi host work')
    expect(await ui.find({ type: 'Text', text: 'reviewing' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /usually 1m 40s/ })).toBeDefined()
    // Steps lose the shell wrapper and the "Finished" echoes.
    expect(await ui.find({ type: 'Text', text: /^00:08 {2}git show 4f2a91c -- src tests$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^01:00 {2}sed -n '60,110p' src\/installer\.ts$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Finished/ })).toBeUndefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a round that finishes between polls raises a toast with its verdict', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = { tasks: [LIVE, SHIP] }
  const seen = host(on, world)
  await $.command.run(paf())
  expect(seen.toasts.filter(text => text.includes('codex'))).toEqual([])

  world.tasks = [{ ...LIVE, status: 'completed', finishedAt: new Date(NOW + 2_000).toISOString(), result: CODEX.result }, SHIP]
  await clock.advance(2_000)
  await $.command.run(paf())
  expect(seen.toasts.filter(text => text.includes('codex'))).toEqual(['✗ codex: 1 blocker · 2 important · Pass 7 on the pi host work'])
})

test('a failing CLI shows its error in the panel instead of throwing', async ($, on) => {
  mock.clock(on, { now: NOW })
  host(on, { tasks: [], pafError: 'Cannot find module better-sqlite3' })
  await $.command.run(paf())

  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /better-sqlite3/ })).toBeDefined()
  await ui.unmount()
})

test('with no reviews yet the panel says what it is for', async ($, on) => {
  mock.clock(on, { now: NOW })
  host(on, { tasks: [] })
  await $.command.run(paf())

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'paf-tasks', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /No reviews in this repository yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ask codex to review this branch' })).toBeDefined()
    await ui.unmount()
  }
})

test('the Agents view lists herdr’s sessions by what needs the person, and jumps on press', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = host(on, { tasks: [LIVE, ELSEWHERE] })
  await $.command.run(paf('agents'))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'paf-tasks', surface, ...PANE })
    expect((await ui.findAll({ type: 'Text', text: /^(NEEDS YOU|WORKING|IDLE)$/ })).map(found => found.text)).toEqual(['NEEDS YOU', 'WORKING', 'IDLE'])
    // Two other sessions want the person; this one is known by its herdr pane, not by its folder.
    expect(await ui.find({ type: 'Text', text: '● 2' })).toBeDefined()
    expect((await ui.find({ key: 'agent-w4:p1' }))?.props.label).toBe('Search slice round 4')
    expect(await ui.findAll({ type: 'Text', text: 'this session' })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /#4 · claude · recipe-app/ })).toBeDefined()
    // What the reviewers are doing, or last said, in each session's worktree.
    expect(await ui.find({ type: 'Text', text: /waiting on codex · Pass 7 on the pi host work · 01:12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /codex: ship · 5h ago/ })).toBeDefined()

    await ui.press({ key: 'agent-w5:p1' })
    await ui.press({ key: 'view-calls' })
    expect(await ui.find({ key: 'round-a81f03c2' })).toBeDefined()
    await ui.press({ key: 'view-agents' })
    await ui.unmount()
  }
  expect(seen.runs.filter(argv => argv[2] === 'focus')).toEqual([
    ['herdr', 'agent', 'focus', 'w5:p1'],
    ['herdr', 'agent', 'focus', 'w5:p1'],
  ])
})

test('without herdr the Agents view is not offered', async ($, on) => {
  mock.clock(on, { now: NOW })
  host(on, { tasks: [SHIP], herdr: 'missing' })
  await $.command.run(paf())

  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'view-agents' })).toBeUndefined()
  expect(await ui.find({ key: 'round-b2d2d470' })).toBeDefined()
  await ui.unmount()
})

test('without herdr, herdr is asked again once a minute, not on every tick', async ($, on) => {
  const clock = mock.clock(on, { now: NOW + 600_000 })
  const seen = host(on, { tasks: [SHIP], herdr: 'missing' })
  await $.command.run(paf())
  const asked = () => seen.runs.filter(argv => argv[0] === 'herdr' && argv[2] === 'list').length
  const first = asked()
  await clock.advance(2_000)
  await $.command.run(paf())
  expect(asked()).toBe(first)
  await clock.advance(60_000)
  await $.command.run(paf())
  expect(asked()).toBeGreaterThan(first)
})

test('a phone-a-friend too old for the panel says so', async ($, on) => {
  mock.clock(on, { now: NOW })
  host(on, { tasks: [], pafError: "error: unknown command 'task'" })
  await $.command.run(paf())

  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /too old for the panel, which needs 4\.5\.0/ })).toBeDefined()
  await ui.unmount()
})

test('the band speaks only while the panel is not on screen', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  const world: World = { tasks: [LIVE, ELSEWHERE], isPlaced: false }
  host(on, world)
  expect(await $.command.run(paf())).toEqual({ text: 'phone-a-friend panel not shown: the terminal is too narrow' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'paf-tasks', surface, ...BAND })
    expect((await ui.find({ type: 'Text', text: /codex/ }))?.text).toBe("⠋ codex · Pass 7 on the pi host work · 01:12 · sed -n '60,110p' src/installer.ts")
    await ui.unmount()
  }

  // Once the panel is placed it says all this itself.
  world.isPlaced = true
  await $.command.run(paf())
  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /codex/ })).toBeUndefined()
  await ui.unmount()
})

const RELAY = 'phone-a-friend --to codex --repo . --session pi-impl --prompt "Review this branch (pi host slice). Look for: ownership checks on uninstall."'
const done = (id: string, command: string, stdout: string) => ({
  tool_use_id: id,
  tool: 'Bash',
  input: { command, description: 'Ask Codex' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { stdout, stderr: '', interrupted: false },
})

test('in the conversation a folded call is drawn as a call: who was asked, the verdict, a line a finding', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`Ran ${e.props.calls.length} shell commands`}</Text>
  })
  host(on, { tasks: [CODEX] })
  await $.command.run(paf())
  const output = `Task 4dba04f2 started · phone-a-friend task show 4dba04f2\n${CODEX.result}\n◇ Task 4dba04f2 completed · 3m 7s · scope unchanged`

  for (const surface of SURFACES) {
    // The call alone: the count line gives way.
    const alone = await $.ui.mount({
      plugin: 'paf-tasks',
      surface,
      component: 'ToolGroup',
      props: { calls: [done('t1', RELAY, output)], isActive: false, isExpanded: false },
    })
    expect(await alone.find({ type: 'Text', text: /Ran 1 shell commands/ })).toBeUndefined()
    expect((await alone.find({ type: 'Text', text: /^✗ codex/ }))?.text).toBe('✗ codex · Review this branch (pi host slice) · 1 blocker · 2 important · 3m 7s')
    const rows = (await alone.findAll({ type: 'Text', text: /^(blocker|important)\s+\S/ })).map(found => found.text)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toStartWith('blocker   installer.ts:843  A copied skill without the marker is deleted on uninstall.')
    expect(rows[2]).toStartWith('important installer.ts:414  piAgentDir() does not expand')
    await alone.unmount()

    // Beside other commands: the count line stays, the call is told under it.
    const mixed = await $.ui.mount({
      plugin: 'paf-tasks',
      surface,
      component: 'ToolGroup',
      props: { calls: [done('t0', 'git status --short', ' M README.md'), done('t1', RELAY, output)], isActive: false, isExpanded: false },
    })
    expect(await mixed.find({ type: 'Text', text: 'Ran 2 shell commands' })).toBeDefined()
    expect(await mixed.find({ type: 'Text', text: /^✗ codex · Review this branch/ })).toBeDefined()
    await mixed.unmount()

    // Unfolded, and groups with no such call, are the engine's own.
    for (const props of [
      { calls: [done('t1', RELAY, output)], isActive: false, isExpanded: true },
      { calls: [done('t0', 'git status --short', ' M README.md')], isActive: false, isExpanded: false },
    ]) {
      const plain = await $.ui.mount({ plugin: 'paf-tasks', surface, component: 'ToolGroup', props })
      expect(await plain.find({ type: 'Text', text: /shell commands/ })).toBeDefined()
      expect(await plain.find({ type: 'Text', text: /codex/ })).toBeUndefined()
      await plain.unmount()
    }
  }
})

test('a call still running says how long, and a row unfolded with ctrl+o keeps the command', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', { component: 'ToolUse' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  host(on, { tasks: [LIVE] })
  await $.command.run(paf())
  const running = { tool_use_id: 't2', tool: 'Bash', input: { command: `phone-a-friend --to codex --session pi-impl --prompt '${LIVE.promptPreview}'` }, isRunning: true, isErrored: false, isInterrupted: false }

  for (const surface of SURFACES) {
    const group = await $.ui.mount({ plugin: 'paf-tasks', surface, component: 'ToolGroup', props: { calls: [running], isActive: true, isExpanded: false } })
    expect((await group.find({ type: 'Text', text: /codex/ }))?.text).toBe("⠋ codex · Pass 7 on the pi host work · 01:12 · sed -n '60,110p' src/installer.ts")
    await group.unmount()

    const row = await $.ui.mount({ plugin: 'paf-tasks', surface, component: 'ToolUse', props: running })
    expect(await row.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    expect(await row.find({ type: 'Text', text: /^⠋ codex · Pass 7 on the pi host work/ })).toBeDefined()
    await row.unmount()

    // Not a relay: nothing of the mod's.
    const other = await $.ui.mount({ plugin: 'paf-tasks', surface, component: 'ToolUse', props: { ...running, input: { command: 'phone-a-friend task list --json' } } })
    expect(await other.find({ type: 'Text', text: /codex/ })).toBeUndefined()
    await other.unmount()
  }
})

test('while the turn waits on a reviewer the spinner says so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.message ?? e.props.word}</Text>
  })
  on('tool.call', async () => {
    await clock.sleep(5_000)
    return { result: { stdout: 'Ship.', stderr: '', interrupted: false } as never }
  })
  host(on, { tasks: [SHIP] })
  const SPINNER = { component: 'Spinner', props: { word: 'Sautéing', message: null, suffix: '…', mode: 'tool-use' } } as const

  const call = $.tool.call({ tool: 'Bash', command: RELAY, tool_use_id: 't3' })
  await clock.settle()
  for (const surface of SURFACES) {
    const during = await $.ui.mount({ plugin: 'paf-tasks', surface, ...SPINNER })
    expect((await during.find({ type: 'Text' }))?.text).toBe('Waiting on codex')
    await during.unmount()
  }

  await clock.advance(5_000)
  await call
  const after = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...SPINNER })
  expect((await after.find({ type: 'Text' }))?.text).toBe('Sautéing')
  await after.unmount()
})

test('the options are honoured: no conversation rows, and a panel of reviews alone', { options: { transcript: false, panel: 'calls' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine group</Text>
  })
  const seen = host(on, { tasks: [CODEX] })
  await $.command.run(paf())

  const group = await $.ui.mount({
    plugin: 'paf-tasks',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [done('t1', RELAY, CODEX.result ?? '')], isActive: false, isExpanded: false },
  })
  expect(await group.find({ type: 'Text', text: 'engine group' })).toBeDefined()
  expect(await group.find({ type: 'Text', text: /codex/ })).toBeUndefined()
  await group.unmount()

  const ui = await $.ui.mount({ plugin: 'paf-tasks', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'view-agents' })).toBeUndefined()
  await ui.unmount()
  expect(seen.runs.filter(argv => argv[0] === 'herdr')).toEqual([])
})

import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'

import type { HerdrAgent, PafCallStart, PafScope, PafTask, PafView, TimelineEntry } from '../types'
import {
  AGENT_LOOK,
  SEVERITY_COLOR,
  age,
  agentGlyph,
  cleanActivity,
  clock,
  durationOf,
  fit,
  lede,
  lookOf,
  oneLine,
  parseRelay,
  parseWorktrees,
  plain,
  rootOf,
  relayKey,
  roundOfCall,
  scopeText,
  slim,
  slimAgent,
  slimWorkspace,
  spin,
  threadSpan,
  took,
  verdictText,
} from './format'
import type { Binding, CallState, HerdrWorkspace, RelayCall } from './format'
import { handoff, isActive, isSelf, parseTime, placeOf, questionOf, roundOf, threadKeyOf, toAgentCards, toThreads, usualMs } from './model'
import type { AgentCard, AgentState, Here, Round, Thread } from './model'

const PANE = 'paf-tasks'
const TITLE = 'phone-a-friend'
const TICK_MS = 2_000
// While nothing runs, poll PaF on every 8th tick (16 s) so a call started from
// another terminal still shows up. herdr is polled every tick (two ~6 ms calls).
const IDLE_EVERY = 8
// After this session runs a phone-a-friend command, poll every tick for a while.
const HOT_MS = 90_000
// How long a finished call stays in the band.
const RECENT_MS = 3 * 60_000
const KEPT_TASKS = 80
const KEPT_RESULT_CHARS = 12_000
const WORKTREES_TTL_MS = 60_000
const MAX_WORKTREES = 16
// Another branch with nothing newer than this is folded under "+N more".
const QUIET_BRANCH_MS = 7 * 24 * 60 * 60_000
// How often another worktree of this repository is asked about: one with a
// recent answer every 15 s, a quiet one once a minute. (One with a reviewer
// at work is asked on every tick, like this one.) A few at a time, each given
// 8 s, so a slow one holds up neither the others nor this worktree.
const WARM_EVERY_MS = 15_000
const COLD_EVERY_MS = 60_000
const WARM_FOR_MS = 60 * 60_000
const OTHERS_AT_ONCE = 4
const OTHERS_TIMEOUT_MS = 8_000
const HERDR_RETRY_MS = 60_000
const TIMELINE_STEPS = 5
const FOLDED_ROUNDS = 7
const FOLDED_FINDINGS = 6
const FOLDED_BRANCHES = 8
const FOLDED_PROSE_CHARS = 900
const FULL_PROSE_CHARS = 9_000
// In the conversation, a round shows this many findings, one line each.
const TRANSCRIPT_FINDINGS = 6
const TRANSCRIPT_PROSE_CHARS = 320
const KEPT_CALL_STARTS = 100

const tasksAtom = atom({ plugin: 'paf-tasks', key: 'tasks' } as const, [])
const timelineAtom = atom({ plugin: 'paf-tasks', key: 'timeline' } as const, {})
const frameAtom = atom({ plugin: 'paf-tasks', key: 'frame' } as const, 0)
const polledAtom = atom({ plugin: 'paf-tasks', key: 'polledAt' } as const, 0)
const problemAtom = atom({ plugin: 'paf-tasks', key: 'problem' } as const, null)
const threadAtom = atom({ plugin: 'paf-tasks', key: 'thread' } as const, null)
const roundAtom = atom({ plugin: 'paf-tasks', key: 'round' } as const, null)
const fullAtom = atom({ plugin: 'paf-tasks', key: 'isFull' } as const, false)
const allRoundsAtom = atom({ plugin: 'paf-tasks', key: 'isAllRounds' } as const, false)
const allBranchesAtom = atom({ plugin: 'paf-tasks', key: 'isAllBranches' } as const, false)
const scopeAtom = atom({ plugin: 'paf-tasks', key: 'scope' } as const, 'repo')
const agentsAtom = atom({ plugin: 'paf-tasks', key: 'agents' } as const, [])
const sinceAtom = atom({ plugin: 'paf-tasks', key: 'agentsSince' } as const, {})
const agentsProblemAtom = atom({ plugin: 'paf-tasks', key: 'agentsProblem' } as const, null)
const viewAtom = atom({ plugin: 'paf-tasks', key: 'view' } as const, 'calls')
const waitingAtom = atom({ plugin: 'paf-tasks', key: 'waiting' } as const, [])
const callStartsAtom = atom({ plugin: 'paf-tasks', key: 'callStarts' } as const, {})
const hereAtom = atom({ plugin: 'paf-tasks', key: 'here' } as const, null)
const rootsAtom = atom({ plugin: 'paf-tasks', key: 'roots' } as const, [])
const skippedAtom = atom({ plugin: 'paf-tasks', key: 'skippedWorktrees' } as const, 0)
const branchAtom = atom({ plugin: 'paf-tasks', key: 'branch' } as const, null)
const paneAtom = atom({ plugin: 'paf-tasks', key: 'pane' } as const, null)
const onScreenAtom = atom({ plugin: 'paf-tasks', key: 'isOnScreen' } as const, false)

type Panel = 'both' | 'calls' | 'agents'
type Band = 'auto' | 'always' | 'never'

// Bookkeeping of the polling itself. Nothing here is drawn from: what a
// drawing needs is in $.state, which a hot reload keeps and these do not
// survive (the cost is one silent refresh before toasts resume).
let pollNow: ((isWaited?: boolean) => Promise<void>) | null = null
let inFlight = false
let othersInFlight = false
let agentsInFlight = false
let herdrMissingAt: number | null = null
let stepsWanted: readonly PafTask[] | null = null
let stepsLoop: Promise<void> | null = null
let stepping: Promise<void> = Promise.resolve()
let commits: Promise<void> = Promise.resolve()
let ticks = 0
let hotUntil = 0
let anyActive = false
let anyWorking = false
let waitingCalls = 0
let primedAt: number | null = null
let isClosedByPerson = false
let hasRevealed = false
let lastTasks = ''
let lastSteps = ''
let lastAgents = ''
let lastOnScreen: boolean | null = null
const seen = new Map<string, string>()
const agentStatus = new Map<string, string>()
// This repository's worktrees (and the git directory they share), and each
// one's tasks as last listed.
// `isRepo`: git listed worktrees here; `common` is their shared git directory, null when it could not be read.
// `skipped`: worktrees past MAX_WORKTREES, which are not asked about.
type Place = { at: number; cwd: string; here: string; roots: string[]; skipped: number; common: string | null; isRepo: boolean }
let worktrees: Place | null = null
const byRoot = new Map<string, PafTask[]>()
const askedAt = new Map<string, number>()
let selfPane: string | null = null

// What a refresh needs from the engine. The engine wants every mods API call
// written out where it happens, so each hook that refreshes builds one of
// these from its own `$` instead of passing `$` along.
type Io = {
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string; isStdoutTruncated?: boolean }>
  cwd: () => Promise<string>
  now: () => Promise<number>
  toast: (text: string) => void
  scope: () => Promise<PafScope>
  // Whether the other worktrees are read: for the all-worktrees view, or for
  // the Agents view, which says what each session's reviewer last did.
  wantsOthers: () => Promise<boolean>
  problem: (text: string | null) => Promise<unknown>
  // `null` leaves a value as it is, so an unchanged list redraws nothing.
  save: (tasks: PafTask[] | null, timeline: Record<string, TimelineEntry[]> | null, now: number) => Promise<unknown>
  savePlace: (here: string, roots: string[], skipped: number) => Promise<unknown>
  // The branch checked out here, null on a detached HEAD.
  saveBranch: (branch: string | null) => Promise<unknown>
  // A new call started: show it instead of whatever was selected.
  follow: () => Promise<unknown>
  since: () => Promise<Record<string, number>>
  saveAgents: (agents: HerdrAgent[], since: Record<string, number>, problem: string | null) => Promise<unknown>
  // Whether the panel is on screen, as the engine has it, and where that is kept.
  onScreen: () => Promise<boolean>
  saveOnScreen: (value: boolean) => Promise<unknown>
  // Opens the panel unasked, where the person's settings allow it.
  reveal: () => Promise<unknown>
}

// What changed since the last look: tasks that finished (toasted) and whether
// a new one started in this worktree. The first look only records.
function compare(tasks: PafTask[], here: string): { finished: PafTask[]; started: boolean } {
  const finished: PafTask[] = []
  let started = false
  for (const task of tasks) {
    const before = seen.get(task.id)
    seen.set(task.id, task.status)
    if (primedAt === null || before === task.status) continue
    if (isActive(task)) {
      // A call in another worktree does not take the panel away from this one.
      if (before === undefined && task.repoPath === here) started = true
      continue
    }
    const end = parseTime(task.finishedAt)
    const wasActive = before === 'running' || before === 'queued'
    if (wasActive || (before === undefined && end !== null && end >= primedAt)) finished.push(task)
  }
  // Tasks that left the list long ago need no remembering.
  if (seen.size > 400) {
    const listed = new Set(tasks.map(task => task.id))
    for (const id of seen.keys()) if (!listed.has(id)) seen.delete(id)
  }

  return { finished, started }
}

// The last steps of a running task, as seconds since it started.
function toTimeline(task: PafTask, events: readonly { ts?: string; type?: string; message?: string | null }[]): TimelineEntry[] {
  const started = parseTime(task.startedAt) ?? 0
  return events
    .filter(event => event.message && event.type !== 'started' && event.type !== 'session_linked' && !/^Finished\b/i.test(event.message))
    .map(event => ({
      at: Math.max(0, Math.round(((parseTime(event.ts ?? null) ?? started) - started) / 1000)),
      text: cleanActivity(event.message ?? ''),
    }))
    .slice(-TIMELINE_STEPS)
}

// "✗ codex: 1 blocker · 2 important · Round 3 for #400", and where when it is another worktree.
function toastOf(task: PafTask): string {
  const round = roundOf(task)
  const here = worktrees?.here ?? null
  const elsewhere = here !== null && task.repoPath !== null && task.repoPath !== here ? ` (${placeOf(task.repoPath).worktree ?? placeOf(task.repoPath).repo})` : ''
  return `${lookOf(round, 0).glyph} ${task.backend}${elsewhere}: ${verdictText(round)} · ${round.title}`
}

const reasonOf = (err: unknown): string => oneLine(err instanceof Error ? err.message : String(err))
// "$.process.run(x) failed to start: ENOENT" is the command not being installed.
const isNotInstalled = (reason: string): boolean => /failed to start|ENOENT|not found|no such file/i.test(reason)

// This repository's worktrees, as git lists them. PaF is asked about each one
// by path and never for its whole store, which holds every repository's
// records: another repository's prompts and answers are not read at all.
async function worktreesOf(io: Io, cwd: string, now: number): Promise<Place> {
  if (worktrees === null || worktrees.cwd !== cwd || now - worktrees.at >= WORKTREES_TTL_MS) {
    let all: string[] = []
    let roots: string[] = []
    let common: string | null = null
    let isListed = false
    try {
      const [listed, dir] = await Promise.all([
        io.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain'], 5_000),
        io.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], 5_000),
      ])
      if (listed.exitCode === 0) {
        all = parseWorktrees(listed.stdout)
        roots = all.slice(0, MAX_WORKTREES)
        isListed = true
      }
      if (dir.exitCode === 0) common = dir.stdout.trim() || null
    } catch {
      // No git, or not a repository: this directory alone.
    }
    const here = rootOf(cwd, roots) ?? cwd
    if (!roots.includes(here)) roots.unshift(here)
    const skipped = all.filter(root => !roots.includes(root)).length
    if (isListed) {
      // What was listed for a worktree that is gone is let go.
      for (const root of [...byRoot.keys()]) {
        if (!roots.includes(root)) {
          byRoot.delete(root)
          askedAt.delete(root)
        }
      }
    }
    // A listing that failed, or a git directory that could not be read, is asked for again in a few seconds.
    worktrees = { at: isListed && common !== null ? now : now - WORKTREES_TTL_MS + 5_000, cwd, here, roots, skipped, common, isRepo: isListed }
  }
  // Written only when it differs from what $.state holds.
  await io.savePlace(worktrees.here, worktrees.roots, worktrees.skipped)
  return worktrees
}

// The branch checked out in this worktree, asked on every refresh so a switch
// shows up at once. null on a detached HEAD; undefined when git cannot say.
async function branchOf(io: Io, root: string): Promise<string | null | undefined> {
  try {
    const found = await io.run(['git', '-C', root, 'branch', '--show-current'], 5_000)
    if (found.exitCode !== 0) return undefined
    return found.stdout.trim() || null
  } catch {
    return undefined
  }
}

// Whether a listed path is, right now, a worktree of this repository: the
// list is a minute old at most, and in that minute a worktree can be removed
// and another repository put in its place. Asked just before PaF is; when it
// cannot be told, the path is left alone.
async function isOurs(io: Io, root: string, common: string | null): Promise<boolean> {
  if (common === null) return false
  try {
    const found = await io.run(['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], 5_000)
    return found.exitCode === 0 && found.stdout.trim() === common
  } catch {
    return false
  }
}

// One worktree's tasks, newest first; a string when PaF refused.
async function listTasks(io: Io, root: string, limit: number, timeoutMs: number): Promise<PafTask[] | string> {
  const listed = await io.run(['phone-a-friend', 'task', 'list', '--json', '--limit', String(limit), '--repo', root], timeoutMs)
  if (listed.exitCode !== 0) {
    // Before 4.5.0 there is no `task` command: the relay reads it as stray arguments.
    if (/unknown (?:command|option)|too many arguments/i.test(listed.stderr)) return TOO_OLD
    return fit(oneLine(listed.stderr) || `phone-a-friend exited ${listed.exitCode}`, 240)
  }
  if (listed.isStdoutTruncated) return 'The task list was too long to read. Narrow it with: phone-a-friend task prune --older-than 30'
  try {
    return (JSON.parse(listed.stdout) as Record<string, unknown>[]).map(slim)
  } catch {
    // phone-a-friend before the fix cut its piped output at 64 KiB.
    return 'phone-a-friend cut its task list short, so it could not be read. Update phone-a-friend: npm install -g @freibergergarcia/phone-a-friend'
  }
}

const TOO_OLD = 'This phone-a-friend is too old for the panel, which needs 4.5.0 or newer. Update it: npm install -g @freibergergarcia/phone-a-friend'

const startOf = (task: PafTask): number => parseTime(task.startedAt) ?? parseTime(task.createdAt) ?? 0

// How long to leave another worktree alone before asking again.
function beatOf(list: PafTask[] | undefined, now: number): number {
  if (list === undefined || list.some(isActive)) return 0
  const latest = Math.max(0, ...list.map(task => parseTime(task.finishedAt) ?? 0))
  return now - latest < WARM_FOR_MS ? WARM_EVERY_MS : COLD_EVERY_MS
}

async function eachLimited<T>(items: readonly T[], atOnce: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T
      next += 1
      await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, lane))
}

// Puts what is known on screen: the worktrees' lists merged, newest first,
// with the steps of whatever is running. One at a time, in the order asked,
// so an older view never lands on top of a newer one.
function commit(io: Io): Promise<void> {
  const run = async (): Promise<void> => {
    const place = worktrees
    if (place === null) return
    const scope = await io.scope()
    const tasks = ((await io.wantsOthers()) ? place.roots : [place.here])
      .flatMap(root => byRoot.get(root) ?? [])
      .sort((a, b) => startOf(b) - startOf(a))
      .slice(0, KEPT_TASKS)
      .map(task => (task.result !== null && task.result.length > KEPT_RESULT_CHARS ? { ...task, result: task.result.slice(0, KEPT_RESULT_CHARS) } : task))

    const now = await io.now()
    // Toasts and following a new call keep to what the panel shows.
    const { finished, started } = compare(scope === 'project' ? tasks : tasks.filter(task => task.repoPath === place.here), place.here)
    if (primedAt === null) primedAt = now
    for (const task of finished) io.toast(toastOf(task))
    if (started) {
      hotUntil = now + HOT_MS
      await io.follow()
    }
    anyActive = tasks.some(isActive)

    const stamp = tasks.map(task => `${task.id}:${task.status}:${task.finishedAt ?? ''}`).join('|')
    await io.save(stamp === lastTasks ? null : tasks, null, now)
    lastTasks = stamp
    // The steps follow on their own: a slow `task show` holds up no list.
    stepping = refreshSteps(io, tasks)
    // The panel opens by itself only for a call in this worktree that is
    // running or just finished, never for history.
    const isFresh = (task: PafTask): boolean => isActive(task) || now - (parseTime(task.finishedAt) ?? 0) < RECENT_MS
    if (!hasRevealed && tasks.some(task => task.repoPath === place.here && isFresh(task))) {
      hasRevealed = true
      await io.reveal()
      await syncOnScreen(io)
    }
  }
  commits = commits.then(run, run)
  return commits
}

// What each running call is doing, read from its event log, a few at once.
// Works on the newest task set asked for: one that arrives while a fetch runs
// is fetched next, and the older fetch's result is dropped, never written.
function refreshSteps(io: Io, tasks: readonly PafTask[]): Promise<void> {
  stepsWanted = tasks
  if (stepsLoop === null) {
    stepsLoop = runSteps(io).finally(() => {
      stepsLoop = null
    })
  }
  return stepsLoop
}

async function runSteps(io: Io): Promise<void> {
  while (stepsWanted !== null) {
    const wanted = stepsWanted
    stepsWanted = null
    const timeline: Record<string, TimelineEntry[]> = {}
    await Promise.all(
      wanted
        .filter(isActive)
        .slice(0, 3)
        .map(async task => {
          try {
            const shown = await io.run(['phone-a-friend', 'task', 'show', task.id, '--json'], 8_000)
            if (shown.exitCode !== 0) return
            const parsed = JSON.parse(shown.stdout) as { events?: { ts?: string; type?: string; message?: string | null }[] }
            timeline[task.id] = toTimeline(task, parsed.events ?? [])
          } catch {
            // The steps are a nicety: the list stands without them.
          }
        }),
    )
    if (stepsWanted !== null) continue
    const steps = JSON.stringify(timeline)
    if (steps !== lastSteps) {
      lastSteps = steps
      await io.save(null, timeline, await io.now())
    }
  }
}

// The worktrees this session is not in. On their own beat and on their own
// time: this worktree's list is on screen before they are asked about.
async function refreshOthers(io: Io): Promise<void> {
  const place = worktrees
  if (othersInFlight || place === null) return
  othersInFlight = true
  try {
    const asked = await io.now()
    const due = place.roots.filter(root => root !== place.here && asked - (askedAt.get(root) ?? 0) >= beatOf(byRoot.get(root), asked))
    if (due.length === 0) return
    await eachLimited(due, OTHERS_AT_ONCE, async root => {
      askedAt.set(root, asked)
      if (!(await isOurs(io, root, place.common))) {
        byRoot.set(root, [])
        return
      }
      const list = await listTasks(io, root, 40, OTHERS_TIMEOUT_MS).catch(() => null)
      // Checked again after: a list read while the path changed hands is dropped unseen.
      if (Array.isArray(list) && (await isOurs(io, root, place.common))) byRoot.set(root, list)
      else if (!byRoot.has(root)) byRoot.set(root, [])
    })
    await commit(io)
  } catch {
    // The next beat asks again.
  } finally {
    othersInFlight = false
  }
}

// `isWaited`: the person asked, so the other worktrees are waited for too.
// Drops everything known and everything drawn: what was read for this folder
// may belong to another repository now, so nothing of it stays on screen or
// within reach of Send to Claude.
async function forget(io: Io, problem: string): Promise<void> {
  byRoot.clear()
  askedAt.clear()
  worktrees = null
  anyActive = false
  lastTasks = ''
  lastSteps = ''
  stepsWanted = null
  await commits
  await io.save([], {}, await io.now())
  await io.follow()
  await io.problem(problem)
}

async function refresh(io: Io, isWaited = false): Promise<void> {
  if (inFlight) return
  inFlight = true
  let others: Promise<void> | null = null
  try {
    const cwd = await io.cwd()
    let place = await worktreesOf(io, cwd, await io.now())
    // The list may be a minute old: this worktree is asked about only while
    // it is still this repository's. Otherwise it is listed again from git.
    // Only a path git confirms as this repository is asked about; outside git, nothing is.
    const isConfirmed = async (): Promise<boolean> => place.isRepo && (await isOurs(io, place.here, place.common))
    if (!(await isConfirmed())) {
      byRoot.clear()
      askedAt.clear()
      worktrees = null
      place = await worktreesOf(io, cwd, await io.now())
      if (!(await isConfirmed())) {
        await forget(
          io,
          place.isRepo
            ? 'This folder changed repository while it was being read. Asking again shortly.'
            : 'Not a git repository. Reviews are shown per repository, so there is nothing to list here.',
        )
        return
      }
    }
    const [mine, branch] = await Promise.all([listTasks(io, place.here, 60, 15_000), branchOf(io, place.here)])
    if (branch !== undefined) await io.saveBranch(branch)
    // Checked again after: a list read while the path changed hands is dropped unseen.
    if (typeof mine !== 'string' && !(await isConfirmed())) {
      await forget(io, 'This folder changed repository while it was being read. Asking again shortly.')
      return
    }
    if (typeof mine === 'string') {
      // Nothing is known to be running any more: back to the idle beat.
      anyActive = false
      await io.problem(mine)
      return
    }
    byRoot.set(place.here, mine)
    await commit(io)
    if (await io.wantsOthers()) others = refreshOthers(io)
  } catch (err) {
    anyActive = false
    lastTasks = ''
    const reason = reasonOf(err)
    await io.problem(
      isNotInstalled(reason) ? 'phone-a-friend is not on PATH. Install it with: npm install -g @freibergergarcia/phone-a-friend' : fit(`phone-a-friend: ${reason}`, 240),
    )
  } finally {
    inFlight = false
  }
  if (isWaited) await Promise.all([others, stepping])
}

// herdr's view of every agent pane. Drawn in the pane only: other sessions'
// titles stay on screen and are never sent to Claude.
async function refreshAgents(io: Io): Promise<void> {
  // One at a time: a slow answer must not land on top of a newer one.
  if (agentsInFlight) return
  // Without herdr, asking every two seconds only spawns a process that fails: once a minute is enough.
  if (herdrMissingAt !== null && (await io.now()) - herdrMissingAt < HERDR_RETRY_MS) return
  agentsInFlight = true
  try {
    const [listed, spaces] = await Promise.all([io.run(['herdr', 'agent', 'list'], 5_000), io.run(['herdr', 'workspace', 'list'], 5_000)])
    if (listed.exitCode !== 0) {
      lastAgents = ''
      anyWorking = false
      // 127 is a command that could not be run at all (its interpreter is gone).
      if (listed.exitCode === 127) herdrMissingAt = await io.now()
      await io.saveAgents([], {}, listed.exitCode === 127 ? 'missing' : fit(oneLine(listed.stderr) || `herdr exited ${listed.exitCode}`, 240))
      return
    }
    herdrMissingAt = null
    const workspaces = new Map<string, HerdrWorkspace>()
    if (spaces.exitCode === 0) {
      const parsedSpaces = JSON.parse(spaces.stdout) as { result?: { workspaces?: Record<string, unknown>[] } }
      for (const raw of parsedSpaces.result?.workspaces ?? []) workspaces.set(...slimWorkspace(raw))
    }
    const parsed = JSON.parse(listed.stdout) as { result?: { agents?: Record<string, unknown>[] } }
    const agents = (parsed.result?.agents ?? []).map(raw => slimAgent(raw, workspaces))
    anyWorking = agents.some(agent => agent.status === 'working')
    const key = JSON.stringify(agents)
    if (key === lastAgents) return

    // When each agent entered its state, for the ones seen changing.
    const now = await io.now()
    const here: Here = { root: worktrees?.here ?? (await io.cwd()), pane: selfPane }
    const since = { ...(await io.since()) }
    const isPrimed = lastAgents !== ''
    for (const agent of agents) {
      const before = agentStatus.get(agent.id)
      agentStatus.set(agent.id, agent.status)
      if (before === undefined || before === agent.status) continue
      since[agent.id] = now
      if (isPrimed && !isSelf(agent, here) && (agent.status === 'blocked' || agent.status === 'done')) {
        const topic = agent.title.replace(/^[^\p{L}\p{N}]+/u, '').trim() || `${agent.agent} in ${placeOf(agent.cwd).repo}`
        io.toast(agent.status === 'blocked' ? `● ${fit(topic, 48)} needs you` : `✓ ${fit(topic, 48)} finished`)
      }
    }
    const listedIds = new Set(agents.map(agent => agent.id))
    for (const id of [...agentStatus.keys()]) if (!listedIds.has(id)) agentStatus.delete(id)
    for (const id of Object.keys(since)) if (!listedIds.has(id)) delete since[id]
    lastAgents = key
    await io.saveAgents(agents, since, null)
  } catch (err) {
    lastAgents = ''
    anyWorking = false
    const reason = reasonOf(err)
    if (isNotInstalled(reason)) herdrMissingAt = await io.now()
    await io.saveAgents([], {}, isNotInstalled(reason) ? 'missing' : fit(`herdr: ${reason}`, 240))
  } finally {
    agentsInFlight = false
  }
}

// The engine knows whether the panel is on screen (it places a waiting pane
// when the terminal widens, and a reload keeps the pane up); the band and the
// conversation rows read it from $.state, kept in step here.
async function syncOnScreen(io: Io): Promise<void> {
  try {
    const value = await io.onScreen()
    if (value === lastOnScreen) return
    lastOnScreen = value
    await io.saveOnScreen(value)
  } catch {
    // Asked again on the next tick.
  }
}

const shows = (panel: Panel, view: PafView): boolean => panel === 'both' || panel === view

// A finding reads as a sentence; one that opens with code (`installPath()` ...) is left as written.
const capital = (text: string): string => (/^[a-z]+(?:[\s,;:]|$)/.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : text)

// ---------------------------------------------------------------- the call in the conversation

// The elements every surface has.
type Ui = Pick<ElementTable<'mobile'>, 'Box' | 'Text' | 'Markdown'>

type CallView = { call: RelayCall; state: CallState; task: PafTask | null; round: Round | null; startedAt: number | null }
type Live = { frame: number; now: number; step: string | null; usual: number | null }

// A call's start and its twins' (the other calls of this session that asked the same thing).
function bindingOf(starts: Record<string, PafCallStart>, id: string | undefined, call: RelayCall): Binding | null {
  // Read leniently: an older version of this mod kept a bare number here.
  const own = id !== undefined ? starts[id] : undefined
  if (own === undefined || typeof own !== 'object') return null
  const key = relayKey(call)
  const twins = Object.entries(starts).flatMap(([other, start]) =>
    other !== id && typeof start === 'object' && start.key === key ? [{ id: other, at: start.at, task: start.task, isBackground: start.isBackground }] : [],
  )
  return { id: id as string, at: own.at, isBackground: own.isBackground, twins }
}

const isLiveView = (view: CallView): boolean => (view.round === null ? view.state.isRunning : view.round.state === 'live')

// One line for a call: who was asked, about what, and how it stands.
// "⠹ codex · Round 3 · 00:42 · usually 1m 54s · git show 4f2a91c"
// "✗ codex · Round 3 · 1 blocker · 1 important · 1m 52s"
function callLine(ui: Ui, view: CallView, live: Live) {
  const { Text } = ui
  const { call, state, round } = view
  const look = state.isInterrupted
    ? { glyph: '!', color: 'yellow' }
    : round !== null
      ? lookOf(round, live.frame)
      : state.isRunning
        ? { glyph: spin(live.frame), color: 'cyan' }
        : { glyph: '·', color: 'gray' }
  const duration = round !== null ? durationOf(round) : null
  const tail = state.isInterrupted
    ? 'interrupted'
    : isLiveView(view)
      ? [view.startedAt !== null ? clock(live.now - view.startedAt) : 'starting', live.usual !== null ? `usually ${took(live.usual)}` : null, live.step]
          .filter(Boolean)
          .join(' · ')
      : round === null
        ? 'running in the background'
        : [verdictText(round), duration !== null ? took(duration) : null].filter(Boolean).join(' · ')

  return (
    <Text wrap="truncate-end">
      <Text color={look.color}>{`${look.glyph} `}</Text>
      <Text bold>{call.backend ?? 'phone-a-friend'}</Text>
      <Text>{` · ${call.title}`}</Text>
      <Text dimColor>{` · ${tail}`}</Text>
    </Text>
  )
}

// Under the line: what the reviewer said, in its own words, a line a finding.
function callAnswer(ui: Ui, round: Round, hasPanel: boolean) {
  const { Box, Markdown, Text } = ui
  if (round.state === 'live') return null
  const findings = round.answer.findings.slice(0, TRANSCRIPT_FINDINGS)
  const more = round.answer.findings.length - findings.length
  const summary = round.answer.summary ?? ''
  const where = Math.min(26, Math.max(0, ...findings.map(finding => finding.location?.length ?? 0)))
  const isCut = more > 0 || findings.length > 0 || summary.length > TRANSCRIPT_PROSE_CHARS

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {round.problem !== null && (
        <Text wrap="wrap">
          <Text color="red">{fit(round.problem.line, 300)}</Text>
          {round.problem.hint !== null && <Text dimColor>{` ${round.problem.hint}`}</Text>}
        </Text>
      )}
      {findings.map(finding => (
        <Text wrap="truncate-end">
          <Text color={SEVERITY_COLOR[finding.severity]}>{finding.severity.padEnd(10)}</Text>
          {where > 0 && <Text dimColor>{fit(finding.location ?? '', where).padEnd(where + 2)}</Text>}
          <Text>{plain(capital(finding.text))}</Text>
        </Text>
      ))}
      {more > 0 && <Text dimColor>{`+${more} more`}</Text>}
      {round.problem === null && findings.length === 0 && summary !== '' && <Markdown text={lede(summary, TRANSCRIPT_PROSE_CHARS)} />}
      {round.problem === null && findings.length === 0 && summary === '' && <Text dimColor>No answer text.</Text>}
      {isCut && !hasPanel && <Text dimColor>/paf for the whole answer</Text>}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const settings = options as Record<string, unknown>
  const panel: Panel = settings.panel === 'calls' || settings.panel === 'paf' ? 'calls' : settings.panel === 'agents' ? 'agents' : 'both'
  const band: Band = settings.band === 'always' || settings.band === 'never' ? settings.band : 'auto'
  const isAutoOpen = settings.auto_open !== false
  const isInTranscript = settings.transcript !== false

  const poll = async (io: Io, isWaited = false): Promise<void> => {
    await Promise.all([shows(panel, 'calls') ? refresh(io, isWaited) : null, shows(panel, 'agents') ? refreshAgents(io) : null, syncOnScreen(io)])
  }

  on('session.start', async ($, e, next) => {
    const io: Io = {
      run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
      cwd: () => $.session.cwd(),
      now: () => $.clock.now(),
      toast: text => $.ui.toast(text, { timeoutMs: 8_000 }),
      scope: async () => ((await read($, scopeAtom)) === 'repo' ? 'repo' : 'project'),
      wantsOthers: async () => (await read($, scopeAtom)) !== 'repo' || (shows(panel, 'agents') && herdrMissingAt === null),
      problem: text => update($, problemAtom, () => text),
      save: async (tasks, timeline, now) => {
        if (tasks !== null) await update($, tasksAtom, () => tasks)
        if (timeline !== null) await update($, timelineAtom, () => timeline)
        await update($, problemAtom, () => null)
        await update($, polledAtom, () => now)
      },
      savePlace: async (here, roots, skipped) => {
        if ((await read($, hereAtom)) !== here) await update($, hereAtom, () => here)
        if ((await read($, rootsAtom)).join('\n') !== roots.join('\n')) await update($, rootsAtom, () => roots)
        if ((await read($, skippedAtom)) !== skipped) await update($, skippedAtom, () => skipped)
      },
      saveBranch: async branch => {
        if ((await read($, branchAtom)) !== branch) await update($, branchAtom, () => branch)
      },
      follow: async () => {
        await update($, threadAtom, () => null)
        await update($, roundAtom, () => null)
      },
      since: () => read($, sinceAtom),
      saveAgents: async (agents, since, problem) => {
        await update($, agentsAtom, () => agents)
        await update($, sinceAtom, () => since)
        await update($, agentsProblemAtom, () => problem)
      },
      onScreen: async () => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown),
      saveOnScreen: value => update($, onScreenAtom, () => value),
      reveal: async () => {
        if (isAutoOpen && !isClosedByPerson) await $.ui.open({ id: PANE, title: TITLE, rows: 16 })
      },
    }
    pollNow = isWaited => poll(io, isWaited)
    selfPane = (await $.env.get('HERDR_PANE_ID')) ?? null
    await update($, paneAtom, () => selfPane)

    await $.command.register({
      name: 'paf',
      description: 'phone-a-friend panel: what your reviewers said, round by round (/paf agents, /paf close)',
      immediate: true,
    })
    $.clock.every(TICK_MS, () => {
      ticks += 1
      void syncOnScreen(io)
      void $.clock.now().then(now => {
        if (shows(panel, 'calls') && (anyActive || now < hotUntil || ticks % IDLE_EVERY === 0)) void refresh(io)
        if (shows(panel, 'agents')) void refreshAgents(io)
      })
    })
    // The spinner: only while something is actually working.
    $.clock.every(1_000, () => {
      if (anyActive || anyWorking || waitingCalls > 0) void update($, frameAtom, frame => frame + 1)
    })
    // The reviews panel opens once the first look finds something to read (or
    // at the first call); a panel that is only the agents list has it already.
    if (isAutoOpen && panel === 'agents') {
      hasRevealed = true
      void $.ui.open({ id: PANE, title: TITLE, rows: 16 }).then(() => syncOnScreen(io))
    }
    void poll(io)

    return next(e)
  })

  // /clear, /resume and /branch reset $.state and fire no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    lastTasks = ''
    lastSteps = ''
    lastAgents = ''
    lastOnScreen = null
    await update($, paneAtom, () => selfPane)
    void pollNow?.()

    return next(e)
  })

  on('command.run', { command: 'paf' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    if (wanted === 'close' || wanted === 'hide') {
      isClosedByPerson = true
      await $.ui.close({ id: PANE })
      return {}
    }
    if (wanted === 'agents' && shows(panel, 'agents')) await update($, viewAtom, () => 'agents')
    if ((wanted === 'calls' || wanted === 'reviews') && shows(panel, 'calls')) await update($, viewAtom, () => 'calls')

    isClosedByPerson = false
    hasRevealed = true
    if (selfPane === null) {
      selfPane = (await $.env.get('HERDR_PANE_ID')) ?? null
      await update($, paneAtom, () => selfPane)
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, rows: 16 })
    lastOnScreen = opened.isPlaced
    await update($, onScreenAtom, () => opened.isPlaced)
    // Works before or without session.start too (a test, a failed start).
    pollNow ??= isWaited =>
      poll({
        run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
        cwd: () => $.session.cwd(),
        now: () => $.clock.now(),
        toast: text => $.ui.toast(text, { timeoutMs: 8_000 }),
        scope: async () => ((await read($, scopeAtom)) === 'repo' ? 'repo' : 'project'),
        wantsOthers: async () => (await read($, scopeAtom)) !== 'repo' || (shows(panel, 'agents') && herdrMissingAt === null),
        problem: text => update($, problemAtom, () => text),
        save: async (tasks, timeline, now) => {
          if (tasks !== null) await update($, tasksAtom, () => tasks)
          if (timeline !== null) await update($, timelineAtom, () => timeline)
          await update($, problemAtom, () => null)
          await update($, polledAtom, () => now)
        },
        savePlace: async (here, roots, skipped) => {
          if ((await read($, hereAtom)) !== here) await update($, hereAtom, () => here)
          if ((await read($, rootsAtom)).join('\n') !== roots.join('\n')) await update($, rootsAtom, () => roots)
          if ((await read($, skippedAtom)) !== skipped) await update($, skippedAtom, () => skipped)
        },
        saveBranch: async branch => {
          if ((await read($, branchAtom)) !== branch) await update($, branchAtom, () => branch)
        },
        follow: async () => {
          await update($, threadAtom, () => null)
          await update($, roundAtom, () => null)
        },
        since: () => read($, sinceAtom),
        saveAgents: async (agents, since, problem) => {
          await update($, agentsAtom, () => agents)
          await update($, sinceAtom, () => since)
          await update($, agentsProblemAtom, () => problem)
        },
        onScreen: async () => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown),
        saveOnScreen: value => update($, onScreenAtom, () => value),
        reveal: async () => {
          if (isAutoOpen && !isClosedByPerson) await $.ui.open({ id: PANE, title: TITLE, rows: 16 })
        },
      }, isWaited)
    await pollNow(true)

    return opened.isPlaced ? {} : { text: `phone-a-friend panel not shown: ${opened.reason}` }
  })

  // Closing the panel yourself keeps it closed until you type /paf again.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE) return next(e)
    if (e.origin.kind === 'person') isClosedByPerson = true
    const closed = await next(e)
    // The band and the conversation rows stand in for the panel from here on.
    lastOnScreen = null
    await update($, onScreenAtom, () => false)

    return closed
  })

  // A phone-a-friend call from this session (main thread or a subagent) means
  // a task is about to appear: show the panel and poll every tick until it settles.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.tool !== 'Bash' || !e.command.includes('phone-a-friend')) return next(e)
    const call = parseRelay(e.command)
    // A path or a `task list` that merely names phone-a-friend starts nothing.
    if (call === null && !/\bphone-a-friend\s+--/.test(e.command)) return next(e)
    const began = await $.clock.now()
    hotUntil = began + HOT_MS
    const id = e.tool_use_id
    if (id !== undefined) {
      // Kept in $.state: the call's line reads its clock from here.
      const start: PafCallStart = { at: began, key: call !== null ? relayKey(call) : '', isBackground: e.run_in_background === true }
      await update($, callStartsAtom, starts => ({ ...Object.fromEntries(Object.entries(starts).slice(1 - KEPT_CALL_STARTS)), [id]: start }))
    }
    // The panel opens when the call's task shows up (commit), not on a
    // command that may yet be denied or fail before it starts.
    $.clock.after(1_500, () => void pollNow?.())
    // While the turn waits on a reviewer, its spinner says so.
    const isWaiting = call !== null && e.run_in_background !== true && e.agentId === undefined
    const key = id ?? `call-${began}`
    if (isWaiting) {
      waitingCalls += 1
      await update($, waitingAtom, list => [...list.filter(item => item.id !== key), { id: key, backend: call.backend ?? 'a reviewer', title: call.title }])
    }
    // What the call printed says which task it made; one with no id made none.
    let made: string | null | undefined
    try {
      const result = await next(e)
      if (e.run_in_background !== true) made = /\bTask ([0-9a-f]{8}) (?:started|completed|failed)/.exec(result.text ?? '')?.[1] ?? null
      return result
    } finally {
      if (id !== undefined && made !== undefined) {
        const task = made
        await update($, callStartsAtom, starts => {
          const start = starts[id]
          return start !== undefined && typeof start === 'object' ? { ...starts, [id]: { ...start, task } } : starts
        })
      }
      if (isWaiting) {
        waitingCalls -= 1
        await update($, waitingAtom, list => list.filter(item => item.id !== key))
      }
      void pollNow?.()
    }
  })

  // "Sautéing…" says nothing about a two-minute wait on another model.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.mode !== 'tool-use') return next(e)
    const waiting = await read($, waitingAtom)
    const backends = [...new Set(waiting.map(item => item.backend))]
    if (backends.length === 0) return next(e)

    return next({ ...e, props: { ...e.props, message: `Waiting on ${backends.join(' + ')}` } })
  })

  const relayOf = (tool: string, input: unknown): RelayCall | null => {
    if (!isInTranscript || tool !== 'Bash') return null
    const command = (input as { command?: unknown } | null)?.command
    return typeof command === 'string' ? parseRelay(command) : null
  }

  // The conversation folds finished tool calls into a count ("Ran 1 shell
  // command"), which says nothing of a review. A phone-a-friend call is drawn
  // as what it is: who was asked, about what, and what they said. A group
  // that is only such calls is replaced; a mixed one keeps its count line.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const relays = e.props.calls.flatMap(item => {
      const call = relayOf(item.tool, item.input)
      return call === null ? [] : [{ item, call }]
    })
    if (relays.length === 0) return next(e)

    const ui = $.ui.resolve(e)
    const { Box } = ui
    const tasks = await read($, tasksAtom)
    const starts = await read($, callStartsAtom)
    const hasPanel = await read($, onScreenAtom)
    const views: CallView[] = relays.map(({ item, call }) => {
      const bind = bindingOf(starts, item.tool_use_id, call)
      const found = roundOfCall(call, item, tasks, bind)
      return { call, state: item, ...found, startedAt: found.round?.startedAt ?? bind?.at ?? null }
    })
    const isLive = views.some(isLiveView)
    const frame = isLive ? await read($, frameAtom) : 0
    const timeline = isLive ? await read($, timelineAtom) : {}
    const now = isLive ? await $.clock.now() : 0
    const blocks = views.map(view => (
      <Box flexDirection="column">
        {callLine(ui, view, {
          frame,
          now,
          step: view.task !== null ? (timeline[view.task.id]?.at(-1)?.text ?? null) : null,
          usual: view.task !== null && isActive(view.task) ? usualMs(tasks, view.task) : null,
        })}
        {view.round !== null && !view.state.isInterrupted && callAnswer(ui, view.round, hasPanel)}
      </Box>
    ))
    const isAlone = relays.length === e.props.calls.length && relays.every(({ call }) => call.isOnlyCall)
    if (isAlone) {
      return (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          {blocks}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" paddingLeft={2}>
          {blocks}
        </Box>
      </Box>
    )
  })

  // Unfolded (ctrl+o, --verbose) the person asked for the command and its
  // output as they are: the row stays, with the call's line under it.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => {
    const call = relayOf(e.props.tool, e.props.input)
    if (call === null) return next(e)

    const ui = $.ui.resolve(e)
    const { Box } = ui
    const tasks = await read($, tasksAtom)
    const bind = bindingOf(await read($, callStartsAtom), e.props.tool_use_id, call)
    const found = roundOfCall(call, e.props, tasks, bind)
    const view: CallView = { call, state: e.props, ...found, startedAt: found.round?.startedAt ?? bind?.at ?? null }
    const isLive = isLiveView(view)
    const frame = isLive ? await read($, frameAtom) : 0
    const timeline = isLive ? await read($, timelineAtom) : {}
    const now = isLive ? await $.clock.now() : 0

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box paddingLeft={2}>
          {callLine(ui, view, {
            frame,
            now,
            step: view.task !== null ? (timeline[view.task.id]?.at(-1)?.text ?? null) : null,
            usual: view.task !== null && isActive(view.task) ? usualMs(tasks, view.task) : null,
          })}
        </Box>
      </Box>
    )
  })

  // The band: one quiet line while a reviewer works, and for a few minutes
  // after it answers. With the panel on screen the line would say it twice,
  // so by default it shows only while the panel is not.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || band === 'never' || !shows(panel, 'calls')) return next(e)
    if (band === 'auto' && (await read($, onScreenAtom))) return next(e)

    const tasks = await read($, tasksAtom)
    const timeline = await read($, timelineAtom)
    const frame = await read($, frameAtom)
    const hereRoot = await read($, hereAtom)
    await read($, polledAtom) // redraw on every poll so the clocks tick
    const now = await $.clock.now()
    // The band is about this worktree: another one's reviewer is the panel's business.
    const mine = tasks.filter(task => hereRoot === null || task.repoPath === hereRoot)
    const live = mine.filter(isActive)
    const recent = mine.find(task => {
      const finished = parseTime(task.finishedAt)
      return !isActive(task) && finished !== null && now - finished < RECENT_MS
    })
    const shown = live[0] ?? recent
    if (!shown) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const round = roundOf(shown)
    const look = lookOf(round, frame)
    const step = timeline[shown.id]?.at(-1)?.text
    const tail =
      round.state === 'live'
        ? `${clock(now - (round.startedAt ?? now))}${step ? ` · ${step}` : ''}${live.length > 1 ? ` · +${live.length - 1} more` : ''}`
        : `${verdictText(round)} · ${age(now - (round.finishedAt ?? now))} ago · /paf to read`

    return (
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text color={look.color}>{`${look.glyph} `}</Text>
          <Text bold>{shown.backend}</Text>
          <Text>{` · ${round.title}`}</Text>
          <Text dimColor>{` · ${tail}`}</Text>
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const width = Math.max(28, e.props.bodyColumns)
    const isInline = e.props.placement === 'inline'
    const roots = await read($, rootsAtom)
    const here: Here = { root: (await read($, hereAtom)) ?? (await $.session.cwd()), pane: await read($, paneAtom) }
    // Read leniently: an older version of this mod may have left its own values here.
    const view: PafView = panel === 'both' ? ((await read($, viewAtom)) === 'agents' ? 'agents' : 'calls') : panel
    const frame = await read($, frameAtom)
    const tasks = await read($, tasksAtom)
    const agents = await read($, agentsAtom)
    const agentsProblem = await read($, agentsProblemAtom)
    await read($, polledAtom)
    const now = await $.clock.now()
    const gap = isInline ? 0 : 1
    // Without herdr there are no agents to list, so the view goes unless it was asked for by name.
    const hasAgents = shows(panel, 'agents') && (agentsProblem !== 'missing' || panel === 'agents')
    const hasTabs = panel === 'both' && hasAgents
    const shownView: PafView = hasAgents ? view : 'calls'
    const wanting = agents.filter(agent => !isSelf(agent, here) && (agent.status === 'blocked' || agent.status === 'done')).length

    // The engine draws its close mark over the top right corner: keep it clear.
    const header = (
      <Box columnGap={3} rowGap={0} flexWrap="wrap" paddingRight={4}>
        <Text>
          <Text color="cyan">◇ </Text>
          <Text bold>phone-a-friend</Text>
        </Text>
        {hasTabs && (
          <Box columnGap={2}>
            <Button key="view-calls" plain hotkey="1" label="Reviews" dimColor={shownView !== 'calls'} onPress={() => update($, viewAtom, () => 'calls')} />
            <Button key="view-agents" plain hotkey="2" label="Agents" dimColor={shownView !== 'agents'} onPress={() => update($, viewAtom, () => 'agents')} />
            {wanting > 0 && <Text color="yellow">{`● ${wanting}`}</Text>}
          </Box>
        )}
      </Box>
    )
    const hint = (text: string) => (
      <Box marginTop={gap}>
        <Text dimColor wrap="truncate-end">
          {e.props.isFocused ? text : 'click a row · or ctrl+x tab for the keys'}
        </Text>
      </Box>
    )

    if (shownView === 'agents') {
      const since = await read($, sinceAtom)
      const cards = toAgentCards(agents, since, here)
      // What the reviewers last said in each worktree: tasks come newest first.
      const liveHere = new Map<string, Round>()
      const lastHere = new Map<string, Round>()
      for (const task of tasks) {
        if (!task.repoPath) continue
        if (isActive(task)) liveHere.set(task.repoPath, roundOf(task))
        else if (!lastHere.has(task.repoPath)) lastHere.set(task.repoPath, roundOf(task))
      }

      const card = (item: AgentCard) => {
        const look = AGENT_LOOK[item.state]
        const state = item.isHere ? 'this session' : look.word
        const when = item.since !== null ? ` · ${age(now - item.since)}` : ''
        const place = [item.agent.number != null ? `#${item.agent.number}` : null, item.agent.agent, item.worktree ? `${item.repo} / ${item.worktree}` : item.repo]
          .filter(Boolean)
          .join(' · ')
        // A session may sit in a folder of its worktree; the tasks are filed under the root.
        const root = item.agent.cwd ? (rootOf(item.agent.cwd, roots) ?? item.agent.cwd) : null
        const call = root ? liveHere.get(root) : undefined
        const last = !call && root ? lastHere.get(root) : undefined
        const lastLook = last ? lookOf(last, frame) : null
        const isQuiet = item.state === 'idle' || item.state === 'unknown'
        // A session that wants nothing takes one line: its topic, and where it is.
        const right = isQuiet && !item.isHere ? place : `${state}${when}`
        return (
          <Box flexDirection="column">
            <Box justifyContent="space-between" columnGap={2}>
              <Box columnGap={1} flexShrink={1}>
                <Text color={look.color}>{agentGlyph(item.state, frame)}</Text>
                <Button
                  key={`agent-${item.agent.id}`}
                  plain
                  label={fit(item.topic, Math.max(10, width - right.length - 5))}
                  dimColor={isQuiet}
                  onPress={() => void $.process.run(['herdr', 'agent', 'focus', item.agent.id], { timeoutMs: 5_000 }).catch(() => undefined)}
                />
              </Box>
              {isQuiet && !item.isHere ? (
                <Text dimColor>{place}</Text>
              ) : (
                <Box flexShrink={0}>
                  <Text color={item.isHere ? 'cyan' : look.color}>{state}</Text>
                  <Text dimColor>{when}</Text>
                </Box>
              )}
            </Box>
            {(!isQuiet || item.isHere) && <Text dimColor wrap="truncate-end">{`  ${place}`}</Text>}
            {call && (
              <Text wrap="truncate-end">
                <Text color="cyan">{`  ${spin(frame)} `}</Text>
                <Text dimColor>{`waiting on ${call.task.backend} · ${call.title} · ${clock(now - (call.startedAt ?? now))}`}</Text>
              </Text>
            )}
            {last && lastLook && last.finishedAt !== null && now - last.finishedAt < 24 * 3_600_000 && (
              <Text wrap="truncate-end">
                <Text color={lastLook.color}>{`  ${lastLook.glyph} `}</Text>
                <Text dimColor>{`${last.task.backend}: ${verdictText(last)} · ${age(now - last.finishedAt)} ago`}</Text>
              </Text>
            )}
          </Box>
        )
      }
      const group = (label: string, states: AgentState[]) => {
        const list = cards.filter(item => states.includes(item.state))
        return (
          list.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor bold>
                {label}
              </Text>
              <Box flexDirection="column" rowGap={gap}>
                {list.map(card)}
              </Box>
            </Box>
          )
        )
      }

      return (
        <Box flexDirection="column">
          {header}
          {agentsProblem !== null && agentsProblem !== 'missing' && (
            <Box marginTop={1}>
              <Text color="red" wrap="wrap">
                {agentsProblem}
              </Text>
            </Box>
          )}
          {agentsProblem === 'missing' && (
            <Box marginTop={1} flexDirection="column">
              <Text>herdr is not installed here.</Text>
              <Text dimColor wrap="wrap">
                This view lists the agent sessions herdr runs, so you can see which one needs you and jump to it.
              </Text>
            </Box>
          )}
          {cards.length === 0 && agentsProblem === null && (
            <Box marginTop={1}>
              <Text dimColor>No agent sessions in herdr right now.</Text>
            </Box>
          )}
          {group('NEEDS YOU', ['blocked', 'done'])}
          {group('WORKING', ['working'])}
          {group('IDLE', ['idle', 'unknown'])}
          {cards.length > 0 && hint(`enter jumps to the session${hasTabs ? ' · 1: reviews' : ''} · esc back to the prompt`)}
        </Box>
      )
    }

    const timeline = await read($, timelineAtom)
    const problem = await read($, problemAtom)
    const scope: PafScope = (await read($, scopeAtom)) === 'repo' ? 'repo' : 'project'
    const threadKey = await read($, threadAtom)
    const roundId = await read($, roundAtom)
    const isFull = await read($, fullAtom)
    const isAllRounds = await read($, allRoundsAtom)
    const isAllBranches = await read($, allBranchesAtom)
    const branch = await read($, branchAtom)
    const skipped = await read($, skippedAtom)

    // The Agents view may have read other worktrees; this view shows them only when asked.
    const threads = toThreads(scope === 'project' ? tasks : tasks.filter(task => task.repoPath === here.root))
    // The branch checked out here leads; another worktree's live call never
    // takes its place. Then live, then the latest.
    const currentKey = threadKeyOf(branch, here.root)
    const ranked = [...threads].sort(
      (a, b) =>
        Number(b.key === currentKey) - Number(a.key === currentKey) ||
        Number(b.state === 'live') - Number(a.state === 'live') ||
        b.lastAt - a.lastAt,
    )
    // Another branch is shown only when the person picked it.
    const thread: Thread | null = ranked.find(item => item.key === threadKey) ?? ranked.find(item => item.key === currentKey) ?? null
    const rest = ranked.filter(item => item !== thread)
    // A branch nobody has asked about for a week is history: folded until asked for.
    const isQuiet = (item: Thread): boolean => item.state !== 'live' && now - item.lastAt >= QUIET_BRANCH_MS
    const unfolded = rest.filter(item => !isQuiet(item)).slice(0, FOLDED_BRANCHES)
    const branches = isAllBranches ? rest : unfolded

    const switchScope = async () => {
      await update($, scopeAtom, current => (current === 'repo' ? 'project' : 'repo'))
      await update($, threadAtom, () => null)
      await update($, roundAtom, () => null)
      seen.clear()
      primedAt = null
      lastTasks = ''
      askedAt.clear()
      await pollNow?.(true)
    }
    const openThread = async (key: string) => {
      await update($, roundAtom, () => null)
      await update($, fullAtom, () => false)
      await update($, allRoundsAtom, () => false)
      await update($, threadAtom, () => key)
    }
    const nextThread = async () => {
      const at = thread === null ? -1 : ranked.indexOf(thread)
      const next = ranked[(at + 1) % ranked.length]
      if (next) await openThread(next.key)
    }
    const controls = (
      <Box columnGap={2} marginTop={gap}>
        {rest.length > 0 && <Button key="branch" plain hotkey="b" label="next branch" dimColor onPress={() => void nextThread()} />}
        <Button key="scope" plain hotkey="w" label={scope === 'repo' ? 'all worktrees' : 'this worktree only'} dimColor onPress={() => void switchScope()} />
        <Button key="refresh" plain hotkey="r" label="refresh" dimColor onPress={() => void pollNow?.(true)} />
      </Box>
    )
    const skippedNote =
      scope === 'project' && skipped > 0 ? (
        <Text dimColor wrap="wrap">{`${skipped} more worktree${skipped === 1 ? ' is' : 's are'} not read: the panel reads ${MAX_WORKTREES}.`}</Text>
      ) : null

    const otherBranches = rest.length > 0 && !isInline && (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor bold>
          {scope === 'repo' ? 'OTHER BRANCHES HERE' : 'OTHER BRANCHES'}
        </Text>
        {branches.map(other => {
          const last = other.rounds.at(-1) as Round
          const look = lookOf(other.state === 'live' ? (other.rounds.find(round => round.state === 'live') ?? last) : last, frame)
          const right = `${other.rounds.length} round${other.rounds.length === 1 ? '' : 's'} · ${age(now - other.lastAt)}`
          return (
            <Box justifyContent="space-between" columnGap={2}>
              <Box columnGap={1} flexShrink={1}>
                <Text color={look.color}>{look.glyph}</Text>
                <Button key={`thread-${other.key}`} plain dimColor label={fit(other.title, Math.max(10, width - right.length - 5))} onPress={() => void openThread(other.key)} />
              </Box>
              <Text dimColor>{right}</Text>
            </Box>
          )
        })}
        {rest.length > unfolded.length && (
          <Button
            key="branches"
            plain
            dimColor
            label={isAllBranches ? 'fewer branches' : `+${rest.length - unfolded.length} more`}
            onPress={() => update($, allBranchesAtom, value => !value)}
          />
        )}
      </Box>
    )

    if (thread === null) {
      return (
        <Box flexDirection="column">
          {header}
          {problem !== null && (
            <Box marginTop={1}>
              <Text color="red" wrap="wrap">
                {problem}
              </Text>
            </Box>
          )}
          {problem === null && rest.length > 0 && (
            <Box marginTop={1}>
              <Text>{`No reviews on ${branch ?? 'this detached HEAD'} yet.`}</Text>
            </Box>
          )}
          {otherBranches}
          {problem === null && rest.length === 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text>No reviews {scope === 'repo' ? 'in this worktree' : 'in this repository'} yet.</Text>
              <Box marginTop={gap}>
                <Text dimColor wrap="wrap">
                  When Claude asks another model for a second opinion, the conversation lands here: every round, its verdict and its findings.
                </Text>
              </Box>
              <Box marginTop={gap}>
                <Text dimColor>Try: </Text>
                <Text>ask codex to review this branch</Text>
              </Box>
            </Box>
          )}
          {skippedNote}
          {controls}
        </Box>
      )
    }

    // Newest first, as a conversation reads from the bottom up.
    const rounds = [...thread.rounds].reverse()
    const selected: Round = rounds.find(round => round.task.id === roundId) ?? rounds.find(round => round.state === 'live') ?? (rounds[0] as Round)
    const folded = isInline ? 3 : FOLDED_ROUNDS
    const listed = isAllRounds ? rounds : rounds.slice(0, folded)
    const shownRounds = listed.includes(selected) ? listed : [...listed, selected]
    const order = rounds.map(round => round.task.id)
    const step = (by: number) =>
      update($, roundAtom, current => {
        const at = Math.max(0, order.indexOf(current ?? selected.task.id))
        return order[Math.min(order.length - 1, Math.max(0, at + by))] ?? null
      })

    // The trail: every round's outcome, oldest to newest. A review converging
    // reads ✗ ✗ ✓; one going in circles shows it at a glance.
    const room = Math.max(6, Math.floor((width + 1) / 2) - 1)
    const trail = thread.rounds.slice(-room)
    const worktree = placeOf(thread.rounds.at(-1)?.task.repoPath ?? null).worktree
    const about = [
      thread.backends.join(' + '),
      thread.rounds.length > 1 ? `${thread.rounds.length} rounds over ${threadSpan(thread)}` : '1 round',
      scope === 'project' && worktree ? worktree : null,
    ]
      .filter(Boolean)
      .join(' · ')

    const details = (round: Round) => {
      const task = round.task
      const look = lookOf(round, frame)
      const duration = durationOf(round)
      const meta = [task.backend, task.model, duration !== null ? `took ${took(duration)}` : null, task.sessionLabel ? `session ${task.sessionLabel}` : null]
        .filter(Boolean)
        .join(' · ')
      const asked = questionOf(round)
      const steps = timeline[task.id] ?? []
      const elapsed = now - (round.startedAt ?? now)
      const usual = usualMs(tasks, task)
      const quiet = elapsed / 1000 - (steps.at(-1)?.at ?? 0)
      const barWidth = Math.max(8, Math.min(32, width - 36))
      const filled = usual === null ? 0 : Math.min(barWidth, Math.round((elapsed / usual) * barWidth))
      const findings = isFull ? round.answer.findings : round.answer.findings.slice(0, FOLDED_FINDINGS)
      const prose = round.answer.summary ?? ''
      const proseLimit = isFull ? FULL_PROSE_CHARS : FOLDED_PROSE_CHARS
      const hasMore =
        round.answer.findings.length > findings.length ||
        round.answer.findings.some(finding => finding.detail !== null || finding.text.length > 240) ||
        (round.answer.findings.length > 0 ? prose !== '' : prose.length > FOLDED_PROSE_CHARS)

      return (
        <Box columnGap={1} marginBottom={gap}>
          <Box width={1} flexShrink={0} backgroundColor={look.color} />
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {meta}
            </Text>
            {scopeText(task) !== null && (
              <Text dimColor wrap="truncate-end">
                {scopeText(task)}
              </Text>
            )}
            {asked !== '' && !isInline && (
              <Text dimColor italic wrap="wrap">
                {isFull ? asked : fit(asked, Math.max(40, (width - 2) * 2 - 2))}
              </Text>
            )}

            {round.state === 'live' && (
              <Box flexDirection="column" marginTop={gap}>
                {usual !== null && (
                  <Text wrap="truncate-end">
                    <Text color="cyan">{'━'.repeat(filled)}</Text>
                    <Text dimColor>{'─'.repeat(barWidth - filled)}</Text>
                    <Text dimColor>{elapsed > usual * 1.5 ? `  longer than the usual ${took(usual)}` : `  usually ${took(usual)}`}</Text>
                  </Text>
                )}
                {steps.map(entry => (
                  <Text wrap="truncate-end">
                    <Text dimColor>{`${clock(entry.at * 1_000)}  `}</Text>
                    {entry.text}
                  </Text>
                ))}
                {steps.length === 0 && <Text dimColor>starting…</Text>}
                {steps.length > 0 && quiet > 45 && <Text dimColor italic>{`no new step for ${took(quiet * 1_000)}: thinking is not reported`}</Text>}
              </Box>
            )}

            {round.problem !== null && (
              <Box flexDirection="column" marginTop={gap}>
                <Text color="red" wrap="wrap">
                  {fit(round.problem.line, isFull ? 2_000 : 320)}
                </Text>
                {round.problem.hint !== null && (
                  <Text dimColor wrap="wrap">
                    {round.problem.hint}
                  </Text>
                )}
              </Box>
            )}

            {findings.map(finding => (
              <Box flexDirection="column" marginTop={gap}>
                <Text wrap="truncate-end">
                  <Text color={SEVERITY_COLOR[finding.severity]} bold>
                    {finding.severity}
                  </Text>
                  {finding.location !== null && <Text dimColor>{`  ${finding.location}`}</Text>}
                </Text>
                <Markdown text={capital(isFull ? finding.text : lede(finding.text, 240))} />
                {isFull && finding.detail !== null && <Markdown dimColor text={finding.detail} />}
                {!isFull && finding.detail !== null && finding.text.length < 90 && (
                  <Text dimColor wrap="wrap">
                    {lede(plain(finding.detail), 150)}
                  </Text>
                )}
              </Box>
            ))}
            {round.answer.findings.length > findings.length && <Text dimColor>{`+${round.answer.findings.length - findings.length} more findings`}</Text>}

            {round.state !== 'live' && round.problem === null && round.answer.findings.length === 0 && prose !== '' && (
              <Box marginTop={gap}>
                <Markdown text={prose.length > proseLimit ? `${prose.slice(0, proseLimit)} …` : prose} />
              </Box>
            )}
            {isFull && round.answer.findings.length > 0 && prose !== '' && (
              <Box marginTop={1}>
                <Markdown dimColor text={prose.length > proseLimit ? `${prose.slice(0, proseLimit)} …` : prose} />
              </Box>
            )}
            {round.state !== 'live' && round.problem === null && task.result === null && (
              <Box marginTop={gap}>
                <Text dimColor italic wrap="wrap">
                  The answer was not kept (task_history is set to metadata).
                </Text>
              </Box>
            )}

            {round.state !== 'live' && (
              <Box columnGap={3} marginTop={gap} flexWrap="wrap">
                {task.result !== null && <Button key="send" plain hotkey="s" label="Send to Claude" onPress={() => void $.prompt.submit({ text: handoff(thread, round) })} />}
                {task.result !== null && (
                  <Button key="copy" plain hotkey="c" label="Copy" onPress={press => void $.ui.copy({ text: task.result ?? '', surface: press.surface })} />
                )}
                {hasMore && <Button key="full" plain hotkey="f" label={isFull ? 'Less' : 'Full answer'} onPress={() => update($, fullAtom, value => !value)} />}
                <Text dimColor>{task.id}</Text>
              </Box>
            )}
          </Box>
        </Box>
      )
    }

    const row = (round: Round) => {
      const isSelected = round === selected
      const look = lookOf(round, frame)
      const when = round.state === 'live' ? clock(now - (round.startedAt ?? now)) : round.finishedAt !== null ? age(now - round.finishedAt) : ''
      const words = verdictText(round)
      // In a narrow pane the counts give way to the title.
      const said = width - words.length - when.length - 8 < 18 ? (words.split(' · ')[0] ?? words) : words
      const right = `${said}${when ? ` · ${when}` : ''}`
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between" columnGap={2}>
            <Box columnGap={1} flexShrink={1}>
              <Text color={look.color}>{look.glyph}</Text>
              <Button
                key={`round-${round.task.id}`}
                plain
                label={fit(round.title, Math.max(10, width - right.length - 5))}
                dimColor={!isSelected}
                onPress={() => {
                  void update($, fullAtom, () => false)
                  void update($, roundAtom, () => round.task.id)
                }}
              />
            </Box>
            <Box flexShrink={0}>
              <Text color={isSelected && round.state !== 'answered' ? look.color : undefined} dimColor={!isSelected || round.state === 'answered'}>
                {said}
              </Text>
              {when !== '' && <Text dimColor>{` · ${when}`}</Text>}
            </Box>
          </Box>
          {isSelected && details(round)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header}
        {problem !== null && (
          <Box marginTop={1}>
            <Text color="red" wrap="wrap">
              {problem}
            </Text>
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text bold wrap="truncate-end">
            {thread.title}
          </Text>
          <Text dimColor wrap="truncate-end">
            {about}
          </Text>
          {thread.rounds.length > 1 && (
            <Text wrap="truncate-end">
              {thread.rounds.length > trail.length && <Text dimColor>{'… '}</Text>}
              {trail.map((round, index) => {
                const look = lookOf(round, frame)
                return (
                  <Text color={look.color} bold={round === selected} underline={round === selected}>
                    {`${look.glyph}${index < trail.length - 1 ? ' ' : ''}`}
                  </Text>
                )
              })}
            </Text>
          )}
        </Box>

        <Box flexDirection="column" marginTop={gap}>
          {shownRounds.map(row)}
          {rounds.length > folded && (
            <Button
              key="rounds"
              plain
              hotkey="m"
              dimColor
              label={isAllRounds ? 'fewer rounds' : `${rounds.length - folded} earlier round${rounds.length - folded === 1 ? '' : 's'}`}
              onPress={() => update($, allRoundsAtom, value => !value)}
            />
          )}
        </Box>

        {otherBranches}
        {skippedNote}

        <Box columnGap={2} marginTop={gap} flexWrap="wrap">
          <Button key="older" plain hotkey="j" label="older" dimColor onPress={() => void step(1)} />
          <Button key="newer" plain hotkey="k" label="newer" dimColor onPress={() => void step(-1)} />
          {rest.length > 0 && <Button key="branch" plain hotkey="b" label="next branch" dimColor onPress={() => void nextThread()} />}
          <Button key="scope" plain hotkey="w" label={scope === 'repo' ? 'all worktrees' : 'this worktree only'} dimColor onPress={() => void switchScope()} />
          <Button key="refresh" plain hotkey="r" label="refresh" dimColor onPress={() => void pollNow?.(true)} />
          {e.props.isFocused && <Text dimColor>esc: back to the prompt</Text>}
        </Box>
        {!e.props.isFocused && (
          <Text dimColor wrap="truncate-end">
            click a row · or ctrl+x tab for the keys
          </Text>
        )}
      </Box>
    )
  })
}

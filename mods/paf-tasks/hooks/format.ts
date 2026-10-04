// How rounds, threads and agents are worded and colored on screen.

import type { HerdrAgent, PafTask } from '../types'
import { countsText, isActive, parseTime, roundOf, titleOf, toRound } from './model'
import type { AgentState, Round, Severity, Thread } from './model'

// 00:45, 12:03, 1:02:09
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// How long ago, or how long in a state: 41s, 14m, 3h, 2d
export function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

// How long something took: 41s, 2m 5s, 1h 3m
export function took(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 === 0 ? `${m}m` : `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export const fit = (text: string, width: number): string =>
  width <= 0 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`

export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

// Markdown as plain words, for a toast or a one-line row.
export const plain = (text: string): string =>
  oneLine(
    text
      .replace(/\*\*|__|`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
  )

// The first sentence or two of a finding, for the folded view.
export function lede(text: string, chars: number): string {
  if (text.length <= chars) return text
  const cut = text.slice(0, chars)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(': '))
  const body = stop > chars * 0.45 ? cut.slice(0, stop + 1) : cut.slice(0, Math.max(0, cut.lastIndexOf(' ')))
  // A code span the cut left open would swallow the rest of the line.
  const ticks = body.split('`').length - 1
  return `${ticks % 2 === 1 ? `${body}\`` : body} …`
}

// Picks the fields this mod uses; the rest of the record (hashes, pids) stays in PaF.
export function slim(raw: Record<string, unknown>): PafTask {
  const text = (key: string): string | null => (typeof raw[key] === 'string' ? (raw[key] as string) : null)
  const num = (key: string): number | null => (typeof raw[key] === 'number' ? (raw[key] as number) : null)
  const status = text('status')
  return {
    id: text('id') ?? '????????',
    kind: text('kind') ?? 'relay',
    status:
      status === 'queued' || status === 'running' || status === 'completed' || status === 'failed' || status === 'interrupted'
        ? status
        : 'failed',
    backend: text('backend') ?? 'unknown',
    model: text('model'),
    sandbox: text('sandbox'),
    repoPath: text('repoPath'),
    branch: text('branch'),
    reviewScope: text('reviewScope'),
    reviewBase: text('reviewBase'),
    diffFiles: num('diffFiles'),
    driftDetected: typeof raw.driftDetected === 'boolean' ? raw.driftDetected : null,
    sessionLabel: text('sessionLabel'),
    backendSessionId: text('backendSessionId'),
    promptPreview: text('promptPreview'),
    result: text('result'),
    error: text('error'),
    createdAt: text('createdAt'),
    startedAt: text('startedAt'),
    finishedAt: text('finishedAt'),
  }
}

// The worktree roots in `git worktree list --porcelain`, the main checkout
// first. A bare entry has no files and a prunable one is gone from disk.
export function parseWorktrees(porcelain: string): string[] {
  const roots: string[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n').map(line => line.trim())
    const root = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    if (!root || lines.some(line => line === 'bare' || line.startsWith('prunable'))) continue
    roots.push(root)
  }
  return roots
}

// The listed root that holds `path`: the deepest one, since a worktree can sit inside another.
export function rootOf(path: string, roots: readonly string[]): string | null {
  return roots.filter(root => path === root || path.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0] ?? null
}

export type HerdrWorkspace = { number: number | null; label: string | null; repo: string | null }

// One `herdr workspace list` entry, by its id.
export function slimWorkspace(raw: Record<string, unknown>): [string, HerdrWorkspace] {
  const worktree = (typeof raw.worktree === 'object' && raw.worktree !== null ? raw.worktree : {}) as Record<string, unknown>
  return [
    String(raw.workspace_id ?? ''),
    {
      number: typeof raw.number === 'number' ? raw.number : null,
      label: typeof raw.label === 'string' ? raw.label : null,
      repo: typeof worktree.repo_name === 'string' ? worktree.repo_name : null,
    },
  ]
}

// One `herdr agent list` entry, with the workspace it sits in.
export function slimAgent(raw: Record<string, unknown>, workspaces: ReadonlyMap<string, HerdrWorkspace>): HerdrAgent {
  const text = (key: string): string | null => (typeof raw[key] === 'string' ? (raw[key] as string) : null)
  const workspace = workspaces.get(text('workspace_id') ?? '')
  return {
    id: text('pane_id') ?? text('terminal_id') ?? '?',
    agent: text('agent') ?? 'agent',
    status: text('agent_status') ?? 'unknown',
    cwd: text('foreground_cwd') ?? text('cwd'),
    title: oneLine(text('terminal_title_stripped') ?? text('terminal_title') ?? ''),
    isFocused: raw.focused === true,
    number: workspace?.number ?? null,
    repo: workspace?.repo ?? null,
    workspace: workspace?.label ?? null,
  }
}

// Braille spinner, one cell wide in every terminal font.
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export const spin = (frame: number): string => SPINNER[frame % SPINNER.length] ?? '⠋'

export type Look = { glyph: string; color: string }

// The mark a round wears in the trail and in its row.
export function lookOf(round: Round, frame: number): Look {
  if (round.state === 'live') return { glyph: spin(frame), color: 'cyan' }
  if (round.state === 'ship') return { glyph: '✓', color: 'green' }
  if (round.state === 'revise') return { glyph: '✗', color: round.worst === 'blocker' ? 'red' : 'yellow' }
  if (round.state === 'failed') return { glyph: '!', color: 'red' }
  return { glyph: '·', color: 'gray' }
}

export const SEVERITY_COLOR: Record<Severity, string> = { blocker: 'red', important: 'yellow', finding: 'yellow', nit: 'gray' }

// What a row says after the title. The findings are the facts, so they are
// what a revise says; "ship" is said only when the reviewer said it, and an
// answer that merely had nothing to fix says "no findings".
export function verdictText(round: Round): string {
  const counts = countsText(round.answer.findings)
  if (round.state === 'live') return round.task.status === 'queued' ? 'queued' : 'reviewing'
  if (round.state === 'failed') return round.problem?.label ?? 'failed'
  if (round.state === 'answered') return 'answered'
  if (round.state === 'ship') {
    if (round.answer.source !== 'inferred') return counts ? `ship · ${counts}` : 'ship'
    return counts || 'no findings'
  }
  return counts || 'revise'
}

export function durationOf(round: Round): number | null {
  return round.startedAt !== null && round.finishedAt !== null ? round.finishedAt - round.startedAt : null
}

// "branch vs main · 6 files · tree changed during review"
export function scopeText(task: PafTask): string | null {
  if (task.kind !== 'review' || !task.reviewScope) return null
  const base = task.reviewBase ? ` vs ${task.reviewBase}` : ''
  const files = task.diffFiles != null ? ` · ${task.diffFiles} file${task.diffFiles === 1 ? '' : 's'}` : ''
  const drift = task.driftDetected === true ? ' · tree changed during review' : ''
  return `${task.reviewScope}${base}${files}${drift}`
}

// Backend steps arrive as `Running: /bin/zsh -lc "rtk rg -n …"`; keep the command.
export function cleanActivity(text: string): string {
  return oneLine(text)
    .replace(/^Running:\s*/i, '')
    .replace(/\/bin\/(?:ba|z)?sh\s+-l?c\s+["']/g, '')
    .replace(/\brtk\s+/g, '')
    .replace(/["']\s*(…?)$/, '$1')
}

// "9h", "3d": how long a thread has been going.
export function threadSpan(thread: Thread): string {
  return age(Math.max(0, thread.lastAt - thread.firstAt))
}

export const AGENT_LOOK: Record<AgentState, { color: string; word: string }> = {
  blocked: { color: 'yellow', word: 'needs you' },
  done: { color: 'green', word: 'done' },
  working: { color: 'cyan', word: 'working' },
  idle: { color: 'gray', word: 'idle' },
  unknown: { color: 'gray', word: 'open' },
}

export const agentGlyph = (state: AgentState, frame: number): string =>
  state === 'working' ? spin(frame) : state === 'blocked' ? '●' : state === 'done' ? '✓' : '·'

// ---------------------------------------------------------------- the call as Claude ran it

export type RelayCall = {
  backend: string | null
  label: string | null
  prompt: string | null
  isReview: boolean
  scope: string | null
  // True when the command is that call and nothing else worth showing:
  // at most a `cd` before it and a `tail` after it.
  isOnlyCall: boolean
  title: string
}

type Token = { text: string; isOp: boolean }

// Enough of a shell's word splitting to find one command's flags: quotes,
// backslashes, and the operators between commands.
function tokenize(command: string): Token[] | null {
  const tokens: Token[] = []
  let word = ''
  let hasWord = false
  let i = 0
  const flush = (): void => {
    if (hasWord) tokens.push({ text: word, isOp: false })
    word = ''
    hasWord = false
  }
  while (i < command.length) {
    const ch = command[i] ?? ''
    if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      if (end < 0) return null
      word += command.slice(i + 1, end)
      hasWord = true
      i = end + 1
    } else if (ch === '"') {
      let j = i + 1
      while (j < command.length && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < command.length) j += 1
        word += command[j] ?? ''
        j += 1
      }
      if (j >= command.length) return null
      hasWord = true
      i = j + 1
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[i + 1] ?? ''
      hasWord = true
      i += 2
    } else if (ch === ' ' || ch === '\t') {
      flush()
      i += 1
    } else if (ch === '\n' || ch === ';') {
      flush()
      tokens.push({ text: ';', isOp: true })
      i += 1
    } else if (ch === '&' && command[i + 1] === '&') {
      flush()
      tokens.push({ text: '&&', isOp: true })
      i += 2
    } else if (ch === '|' && command[i + 1] === '|') {
      flush()
      tokens.push({ text: '||', isOp: true })
      i += 2
    } else if (ch === '|') {
      flush()
      tokens.push({ text: '|', isOp: true })
      i += 1
    } else if (ch === '&' && !word.endsWith('>')) {
      flush()
      tokens.push({ text: '&', isOp: true })
      i += 1
    } else {
      word += ch
      hasWord = true
      i += 1
    }
  }
  flush()
  return tokens
}

const NOT_A_RELAY = new Set(['task', 'job', 'session', 'doctor', 'config', 'plugin', 'setup', 'agentic', 'install', 'update', 'uninstall'])
const VALUE_FLAGS = new Set(['--to', '--session', '--prompt', '--review-scope', '--repo', '--base', '--model', '--sandbox', '--backend-session', '--context-file', '--context-text', '--schema', '--timeout', '--peer-messaging'])
const isRedirect = (word: string): boolean => /^\d*[<>]/.test(word)
const isPaf = (word: string): boolean => word === 'phone-a-friend' || word.endsWith('/phone-a-friend')

// Reads a Bash command for a phone-a-friend relay or review, or null when it is not one.
export function parseRelay(command: string): RelayCall | null {
  if (!command.includes('phone-a-friend')) return null
  const tokens = tokenize(command)
  if (tokens === null) return null

  const segments: { words: string[]; before: string | null }[] = []
  let words: string[] = []
  let before: string | null = null
  for (const token of tokens) {
    if (token.isOp) {
      segments.push({ words, before })
      words = []
      before = token.text
    } else {
      words.push(token.text)
    }
  }
  segments.push({ words, before })
  const filled = segments.filter(segment => segment.words.length > 0)

  const at = filled.findIndex(segment => isPaf(segment.words.find(word => !/^[A-Z_][A-Z0-9_]*=/.test(word)) ?? ''))
  const call = filled[at]
  if (!call) return null
  const args = call.words.slice(call.words.findIndex(isPaf) + 1)
  const first = args.find(word => !word.startsWith('-')) ?? null
  if (args[0] && NOT_A_RELAY.has(args[0])) return null
  if (args.includes('--quiet') || args.includes('--help') || args.includes('--version') || args.includes('-h') || args.includes('-V')) return null

  const value = (flag: string): string | null => {
    const inline = args.find(word => word.startsWith(`${flag}=`))
    if (inline) return inline.slice(flag.length + 1)
    const index = args.indexOf(flag)
    return index >= 0 ? (args[index + 1] ?? null) : null
  }
  const prompt = value('--prompt')
  const scope = value('--review-scope')
  const isReview = args.includes('--review') || args.includes('--verdict-json') || scope !== null
  if (prompt === null && !isReview) return null
  // A word that is neither a flag nor a flag's value means this is not the relay form.
  if (first !== null && first !== 'relay') {
    const index = args.indexOf(first)
    const owner = args[index - 1] ?? ''
    if (!VALUE_FLAGS.has(owner) && !isRedirect(first)) return null
  }

  const isOnlyCall =
    !command.includes('<<') &&
    filled.every((segment, index) => {
      if (index === at) return true
      const head = segment.words[0] ?? ''
      if (index < at) return index === at - 1 && head === 'cd' && segment.words.length <= 2
      return index === at + 1 && segment.before === '|' && (head === 'tail' || head === 'head')
    })

  const backend = value('--to')
  return {
    backend,
    label: value('--session'),
    prompt,
    isReview,
    scope,
    isOnlyCall,
    title: titleOf(prompt ?? '', isReview ? 'review' : 'relay', scope, backend ?? 'phone-a-friend'),
  }
}

// PaF records a task moments after the command starts; clocks on one machine agree to well under this.
const START_SLACK_MS = 3_000
const START_WINDOW_MS = 60_000

// How a tool call stands, as its row in the transcript is told.
export type CallState = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean; output?: unknown }

// What the command printed, once it has ended: its answer stream, and both streams together.
function printedOf(state: CallState): { stdout: string; all: string; isBackground: boolean } | null {
  if (state.isRunning || state.output === undefined || state.output === null) return null
  if (typeof state.output === 'string') return { stdout: state.output, all: state.output, isBackground: false }
  const output = state.output as { stdout?: unknown; stderr?: unknown; backgroundTaskId?: unknown }
  const stdout = typeof output.stdout === 'string' ? output.stdout : ''
  const stderr = typeof output.stderr === 'string' ? output.stderr : ''
  return { stdout, all: `${stdout}\n${stderr}`, isBackground: Boolean(output.backgroundTaskId) }
}

// A call of this session as kept in $.state: which tool call, when it began,
// and once it ended in the foreground, the task it printed (null: none).
export type CallStart = { id: string; at: number; task?: string | null; isBackground?: boolean }
// A call's own start, and the starts of this session's other calls that asked the same thing.
export type Binding = CallStart & { twins: readonly CallStart[] }

// What makes two calls the same ask: backend, session label and prompt.
export const relayKey = (call: RelayCall): string => `${call.backend ?? ''}|${call.label ?? ''}|${oneLine(call.prompt ?? '').slice(0, 120)}`

// The task a tool call started. Named in its output: that one. Else, among the
// tasks asked the same thing of the same backend under the same label, the one
// that began right after the call did. When the call's start is not known
// (after a reload), only a match that is the single one of its kind is taken:
// two rows must never claim the same task by guesswork.
export function taskOfCall(call: RelayCall, printed: string | null, isBackground: boolean, tasks: readonly PafTask[], bind: Binding | null = null): PafTask | null {
  const named = /\bTask ([0-9a-f]{8}) (?:started|completed|failed)/.exec(printed ?? '')?.[1]
  if (named) return tasks.find(task => task.id === named) ?? null
  if (printed !== null && !isBackground) return null
  const want = oneLine(call.prompt ?? '').slice(0, 120)
  const matches = tasks.filter(
    task =>
      (call.backend === null || task.backend === call.backend) &&
      (call.label === null || task.sessionLabel === call.label) &&
      (want === '' ? task.kind === 'review' && (task.promptPreview ?? '') === '' : oneLine(task.promptPreview ?? '').startsWith(want)),
  )
  if (bind !== null) {
    const started = matches.map(task => ({ task, at: parseTime(task.startedAt) ?? parseTime(task.createdAt) ?? 0 })).sort((a, b) => a.at - b.at)
    // A task starts after the command that runs it. Calls that asked the same
    // thing take tasks one each, in the order they began: each the first task
    // not yet taken that started after it did, within the minute. So two rows
    // never claim one task.
    const others = bind.twins.filter(twin => twin.id !== bind.id)
    // A twin that ended holds the task it printed, or none: only the ones still open share out the rest.
    const taken = new Set(others.flatMap(twin => (typeof twin.task === 'string' ? [twin.task] : [])))
    const open = others.filter(twin => twin.task === undefined)
    // Begun in the same millisecond, which came first cannot be told.
    if (open.some(twin => twin.at === bind.at)) return null
    // A call in the background never says which task it made, or whether it
    // made one: a task that started after such a twin could be its own, so it
    // is not guessed at. One that started before every such twin is safe.
    const isNear = (twin: CallStart): boolean => Math.abs(twin.at - bind.at) <= START_WINDOW_MS
    const unknown = open.filter(twin => isNear(twin) && (twin.isBackground === true || bind.isBackground === true))
    const calls = [...open, { id: bind.id, at: bind.at }].sort((a, b) => a.at - b.at)
    for (const one of calls) {
      const pick = started.find(item => !taken.has(item.task.id) && item.at >= one.at && item.at <= one.at + START_WINDOW_MS)
      if (one.id !== bind.id) {
        if (pick) taken.add(pick.task.id)
        continue
      }
      if (pick) return unknown.some(twin => pick.at >= twin.at) ? null : pick.task
      // One just before counts only for a call alone, as the only task near it (clocks round).
      const near = started.filter(item => item.at >= bind.at - START_SLACK_MS && item.at <= bind.at + START_WINDOW_MS)
      return calls.length === 1 && near.length === 1 ? (near[0]?.task ?? null) : null
    }
    return null
  }
  const active = matches.filter(isActive)
  if (active.length === 1) return active[0] ?? null
  return isBackground && active.length === 0 && matches.length === 1 ? (matches[0] ?? null) : null
}

// The round a tool call became: PaF's own record when the panel holds it,
// else read off what the command printed. No round while nothing is known.
export function roundOfCall(call: RelayCall, state: CallState, tasks: readonly PafTask[], bind: Binding | null = null): { task: PafTask | null; round: Round | null } {
  const printed = printedOf(state)
  const task = taskOfCall(call, printed?.all ?? null, printed?.isBackground ?? false, tasks, bind)
  if (task !== null) return { task, round: roundOf(task) }
  if (printed === null || printed.isBackground || state.isInterrupted) return { task: null, round: null }
  return {
    task: null,
    round: toRound({
      id: '',
      kind: call.isReview ? 'review' : 'relay',
      status: state.isErrored ? 'failed' : 'completed',
      backend: call.backend ?? 'phone-a-friend',
      model: null,
      sandbox: null,
      repoPath: null,
      branch: null,
      reviewScope: call.scope,
      reviewBase: null,
      diffFiles: null,
      driftDetected: null,
      sessionLabel: call.label,
      backendSessionId: null,
      promptPreview: call.prompt,
      result: state.isErrored ? null : answerIn(printed.stdout),
      error: state.isErrored ? answerIn(printed.all) : null,
      createdAt: null,
      startedAt: null,
      finishedAt: null,
    }),
  }
}

// The reviewer's answer inside a tool call's output: PaF's own progress and receipt lines dropped.
export function answerIn(stdout: string): string {
  return stdout
    .split('\n')
    .filter(line => !/^\s*(?:◇|✔|✖|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(line) && !/^\s*Task [0-9a-f]{8} (?:started|completed|failed)\b/.test(line) && !/^\s*\[phone-a-friend\]/.test(line))
    .join('\n')
    .trim()
}

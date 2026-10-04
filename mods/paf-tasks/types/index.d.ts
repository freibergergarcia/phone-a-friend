export type PafStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'

// The fields of `phone-a-friend task list --json` this mod reads.
export type PafTask = {
  id: string
  kind: string
  status: PafStatus
  backend: string
  model: string | null
  sandbox: string | null
  repoPath: string | null
  branch: string | null
  reviewScope: string | null
  reviewBase: string | null
  diffFiles: number | null
  driftDetected: boolean | null
  sessionLabel: string | null
  backendSessionId: string | null
  promptPreview: string | null
  result: string | null
  error: string | null
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

// One agent pane as herdr lists it, with the workspace it sits in.
export type HerdrAgent = {
  id: string
  agent: string
  status: string
  cwd: string | null
  title: string
  isFocused: boolean
  // The workspace's number in herdr, its repository, and its label.
  number: number | null
  repo: string | null
  workspace: string | null
}

// One step of a running call's event log: seconds since it started, and the line.
export type TimelineEntry = { at: number; text: string }

// `repo` is this worktree; `project` is every worktree of the same repository.
export type PafScope = 'repo' | 'project'
export type PafView = 'calls' | 'agents'

// When one of this session's calls began, and what it asked (backend, label, prompt).
// `task`, once a call in the foreground has ended: the task it printed, or null for none.
export type PafCallStart = { at: number; key: string; task?: string | null; isBackground?: boolean }

// A phone-a-friend call this session's own turn is waiting on, by its tool call.
export type PafWaiting = { id: string; backend: string; title: string }

declare module 'claude-code' {
  interface PluginState {
    'paf-tasks': {
      tasks: PafTask[]
      timeline: Record<string, TimelineEntry[]>
      frame: number
      polledAt: number
      problem: string | null
      thread: string | null
      round: string | null
      isFull: boolean
      isAllRounds: boolean
      isAllBranches: boolean
      scope: PafScope
      agents: HerdrAgent[]
      agentsSince: Record<string, number>
      agentsProblem: string | null
      view: PafView
      waiting: PafWaiting[]
      // When each of this session's own calls began, by tool call: a call's
      // line can tick before PaF's record of it shows up, or without one.
      callStarts: Record<string, PafCallStart>
      // Where this session is: its worktree, the repository's worktrees, its pane in herdr.
      here: string | null
      roots: string[]
      pane: string | null
      // Whether the panel is on screen: placed, and the tab that shows.
      isOnScreen: boolean
    }
  }
}

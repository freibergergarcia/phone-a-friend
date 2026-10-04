// Task records shaped like real ones: a long --session review thread on one
// branch, Codex's own way of writing a review, a failure, and a round in
// another worktree of the same repository.

import type { PafTask } from '../types'

export const NOW = Date.parse('2026-10-02T10:00:00.000Z')
export const ROOT = '/work/paf'
export const QUIET = '/work/paf-quiet'

const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString()

export function task(over: Partial<PafTask> & { id: string }, startedAgo: number, tookSeconds: number | null): PafTask {
  return {
    kind: 'relay',
    status: tookSeconds === null ? 'running' : 'completed',
    backend: 'codex',
    model: 'gpt-5.6-terra',
    sandbox: 'read-only',
    repoPath: ROOT,
    branch: 'feat/pi-backend',
    reviewScope: null,
    reviewBase: null,
    diffFiles: null,
    driftDetected: null,
    sessionLabel: 'pi-impl',
    backendSessionId: null,
    promptPreview: '',
    result: null,
    error: null,
    createdAt: ago(startedAgo),
    startedAt: ago(startedAgo),
    finishedAt: tookSeconds === null ? null : ago(startedAgo - tookSeconds),
    ...over,
  }
}

export const LIVE = task(
  { id: 'a81f03c2', promptPreview: 'Pass 7 on the pi host work. One new commit, 4f2a91c; read it with `git show 4f2a91c -- src tests`.' },
  72,
  null,
)

export const SHIP = task(
  {
    id: 'b2d2d470',
    promptPreview: 'Pass 6 on the pi host work. One new commit on top of 6c72744. You asked for the false negative to be documented.',
    result: 'VERDICT: ship\n\nNo findings. The git-source false negative is documented, tested, and limited to status display.',
  },
  7_200,
  111,
)

export const REVISE = task(
  {
    id: 'd26a67ed',
    promptPreview: 'Pass 5 on the pi host work. One new commit, 6c72744. Your finding on the :443 host form is fixed.',
    result:
      'VERDICT: revise\n\n- [important] [src/installer.ts:80] — Pi accepts `git:github.com:owner/phone-a-friend`, but this builds an invalid URL here.\n- [nit] [tests/installer.test.ts:412-430] — the table test never covers the scp-like form.',
  },
  7_600,
  205,
)

// Codex, unprompted: no VERDICT line, P-levels, links to absolute paths.
export const CODEX = task(
  {
    id: '4dba04f2',
    kind: 'review',
    sessionLabel: null,
    reviewScope: 'branch',
    reviewBase: 'origin/main',
    diffFiles: 14,
    driftDetected: true,
    promptPreview: 'Review this branch (pi host slice). Look for: ownership checks on uninstall.',
    result: [
      'Found three defects:',
      '',
      `- P1 — a copied skill without the marker is deleted on uninstall. [installer.ts:843](${ROOT}/src/installer.ts:843) removes the directory when the name matches.`,
      '',
      "  Scenario: create the skill by hand, run `plugin uninstall --pi`.",
      '',
      `- P2 — status says installed for a filtered package entry. [detection.ts:212](${ROOT}/src/detection.ts:212) only checks that the source matches.`,
      '',
      `- P2 — \`piAgentDir()\` does not expand \`~\\\` on Windows. [installer.ts:414](${ROOT}/src/installer.ts:414) handles \`~/\` alone.`,
      '',
      'No on-wire or session-store issue found.',
    ].join('\n'),
  },
  540,
  187,
)

export const LOST = task(
  {
    id: '4be0c1d9',
    status: 'failed',
    promptPreview: 'Follow-up on the plan: does the session preflight still hold with pi 0.99?',
    error: 'Reading additional input from stdin...\nError: thread/resume: thread/resume failed: no rollout found for thread id 01a0fb85-f6cc-7ad2-9c1e-2f4f6d1b7a10',
  },
  2_400,
  2,
)

// Another worktree of the same repository, on its own branch.
export const ELSEWHERE = task(
  {
    id: '96a7ad60',
    repoPath: QUIET,
    branch: 'chore/plugin-directory-readiness',
    sessionLabel: 'pr180-review',
    promptPreview: 'Round 3. I pushed fa87eb2 addressing your README.md:600 finding.',
    result: 'Ship. The prior finding is resolved: recovery wording matches the unconditional cleanup.',
  },
  18_000,
  63,
)

export const PORCELAIN = [
  `worktree ${ROOT}`,
  'HEAD a1a92a31320a0ad45c62ffa73b8761405624a7f0',
  'branch refs/heads/feat/pi-backend',
  '',
  `worktree ${QUIET}`,
  'HEAD 4f2a91c1320a0ad45c62ffa73b8761405624a7f0',
  'branch refs/heads/chore/plugin-directory-readiness',
  '',
  'worktree /private/tmp/gone/pr172',
  'HEAD 6c727441320a0ad45c62ffa73b8761405624a7f0',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n')

export const EVENTS = [
  { ts: ago(72), type: 'started', message: 'relay started via codex' },
  { ts: ago(64), type: 'activity', message: 'Running: /bin/zsh -lc "rtk git show 4f2a91c -- src tests"' },
  { ts: ago(60), type: 'activity', message: 'Finished (exit 0): /bin/zsh -lc "rtk git show 4f2a91c -- src tests"' },
  { ts: ago(12), type: 'activity', message: "Running: /bin/zsh -lc \"rtk sed -n '60,110p' src/installer.ts\"" },
]

export const AGENTS = {
  id: 'cli:agent:list',
  result: {
    type: 'agent_list',
    agents: [
      { agent: 'claude', agent_status: 'working', cwd: ROOT, foreground_cwd: `${ROOT}/src`, pane_id: 'w3:p1', terminal_title_stripped: 'Phone-a-friend mod', focused: true, workspace_id: 'w3' },
      { agent: 'codex', agent_status: 'idle', cwd: ROOT, foreground_cwd: ROOT, pane_id: 'w3:p2', terminal_title_stripped: 'Side shell', focused: false, workspace_id: 'w3' },
      { agent: 'claude', agent_status: 'blocked', cwd: '/work/recipes', foreground_cwd: '/work/recipes', pane_id: 'w4:p1', terminal_title_stripped: '✳ Search slice round 4', focused: false, workspace_id: 'w4' },
      { agent: 'codex', agent_status: 'done', cwd: QUIET, foreground_cwd: QUIET, pane_id: 'w5:p1', terminal_title_stripped: 'pi host symlink ownership', focused: false, workspace_id: 'w5' },
    ],
  },
}

export const WORKSPACES = {
  id: 'cli:workspace:list',
  result: {
    type: 'workspace_list',
    workspaces: [
      { workspace_id: 'w3', number: 3, label: 'paf', worktree: { repo_name: 'phone-a-friend' } },
      { workspace_id: 'w4', number: 4, label: 'recipes', worktree: { repo_name: 'recipe-app' } },
      { workspace_id: 'w5', number: 5, label: 'paf-quiet', worktree: { repo_name: 'phone-a-friend' } },
    ],
  },
}

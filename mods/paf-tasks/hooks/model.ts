// What phone-a-friend calls mean, worked out from the task records alone.
//
// In practice a call is one round of a longer conversation about a branch: a
// reviewer is asked ("Round 3 for #400. Fixed: ..."), answers with findings
// ("Found three defects: ...", "VERDICT: revise", "No real defects."), the fix
// lands, and the next round goes out until the reviewer has nothing left.
// This file turns flat task records into those rounds and threads. It makes no
// engine calls, so it runs the same in a test.

import type { HerdrAgent, PafTask } from '../types'

// `finding` is one the reviewer did not rate ("Found three defects:").
export type Severity = 'blocker' | 'important' | 'finding' | 'nit'
export type Verdict = 'ship' | 'revise' | 'none'
// json: PaF's --verdict-json envelope. declared: the answer says "VERDICT: x"
// or opens with "Ship.". inferred: read off the findings, or "No defects."
export type VerdictSource = 'json' | 'declared' | 'inferred'

export type Finding = {
  severity: Severity
  location: string | null
  // The finding itself, as markdown on one line.
  text: string
  // What the reviewer wrote under it: the scenario, the suggested fix.
  detail: string | null
}

export type Answer = {
  verdict: Verdict
  source: VerdictSource | null
  findings: Finding[]
  // The answer in prose, when there is any beside the findings.
  summary: string | null
}

export type RoundState = 'live' | 'ship' | 'revise' | 'answered' | 'failed'

export type Problem = {
  // Two or three words for a list row: "timed out", "session lost".
  label: string
  // The line of the error that says what went wrong.
  line: string
  // What to do about it, when the failure is a known one.
  hint: string | null
}

export type Round = {
  task: PafTask
  title: string
  state: RoundState
  answer: Answer
  // The most serious finding, which colors a revise round.
  worst: Severity | null
  problem: Problem | null
  startedAt: number | null
  finishedAt: number | null
}

export type Thread = {
  key: string
  // The branch the rounds are about, or the repository when there is none.
  title: string
  repo: string
  backends: string[]
  labels: string[]
  // Oldest first.
  rounds: Round[]
  state: RoundState
  firstAt: number
  lastAt: number
}

export const isActive = (task: PafTask): boolean => task.status === 'running' || task.status === 'queued'

export function parseTime(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

// ---------------------------------------------------------------- answers

const SEVERITY_WORDS: Record<string, Severity> = {
  blocker: 'blocker',
  blockers: 'blocker',
  blocking: 'blocker',
  critical: 'blocker',
  high: 'blocker',
  major: 'important',
  p0: 'blocker',
  p1: 'blocker',
  important: 'important',
  medium: 'important',
  moderate: 'important',
  p2: 'important',
  nit: 'nit',
  nits: 'nit',
  nitpick: 'nit',
  minor: 'nit',
  low: 'nit',
  trivial: 'nit',
  p3: 'nit',
  suggestion: 'nit',
  optional: 'nit',
}
const SEVERITY = 'blockers?|blocking|critical|high|major|p0|p1|important|medium|moderate|p2|nits?|nitpick|minor|low|trivial|p3|suggestion|optional'
const RANK: Record<Severity, number> = { blocker: 0, important: 1, finding: 2, nit: 3 }

const LIST_ITEM = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
// A severity that opens a line or a list item: "[blocker] [src/x.ts:1] — ...",
// "**High — ...**", "P1 [x.ts:3](...): ...", "Important — ...", "- P2: ...".
const TAG = new RegExp(
  `^(\\*\\*|__)?\\s*([\\[(])?\\s*(${SEVERITY})\\b(?:\\s+(?:severity|priority))?\\s*?([\\])])?\\s*?(\\*\\*|__)?(\\s*[—–:]\\s*|\\s+-\\s+|\\.\\s+)?(.*)$`,
  'i',
)
// "One blocker: ...", "Defect: ...", "One new, low-probability edge remains: ..."
const INLINE_LEAD =
  /^(?:(?:one|a|an|two|three|four|five|\d+)\s+)?(?:[\w,'-]+\s+){0,5}?(blocker|defect|issue|bug|concern|problem|regression|edge(?: case)?|gap|bypass|finding|risk)s?(?:\s+(?:remains?|left|found))?\s*:\s+(\S.*)$/i
// "Found 2 defects." announces a list without a colon.
const LEAD_SENTENCE =
  /^(?:i\s+)?(?:found|see|have|identified|there\s+(?:are|is))\s+(?:[\w-]+\s+){0,4}?(?:defects?|issues?|bugs?|findings?|problems?|regressions?|blockers?|concerns?|bypass(?:es)?|refusals?|gaps?)\b[^.]{0,40}[.:]?\s*$/i
// "**Hard standards violation — [db.ts](...).** text", "**Spec finding — partial coverage.** text"
const BOLD_LEAD = /^\*\*([^*]+)\*\*\s*(.*)$/
// "The single most likely correctness bug is that ...": one defect, told as a sentence.
const PROSE_DEFECT =
  /^(?:the\s+)?(?:(?:single|one|main|only|most\s+likely|likeliest|biggest|real|remaining|clearest)\s+)+(?:[\w-]+\s+){0,2}?(?:bug|defect|issue|problem|regression|flaw)\s+(?:here\s+)?is\s+(?:that\s+)?(\S.*)$/i
// "**Location:** Line 485 in `Frame::Result` parsing." says where the finding above is.
const WHERE_LABEL = /^(?:location|where|file|site)s?\s*:?\s*$/i
const BOLD_NOUN = /\b(findings?|violations?|conflicts?|defects?|bugs?|regressions?|blockers?|missing|partial|gaps?)\b/i
const NEGATED = /\b(?:no|not|none|without|zero)\b/i
// A line that announces a list of findings: "Found three defects:", "Findings, highest severity first:"
const FINDINGS_LEAD =
  /\b(findings?|defects?|issues?|bugs?|blockers?|blocking|bypass(?:es)?|regressions?|refusals?|problems?|concerns?|gaps?|risks?|nits?|suggestions?|objections?|violations?|must[- ]fix|should[- ]fix|required changes|remain(?:s|ing)?|request changes)\b/i
// A line that announces a list that is not findings: "Verified:", "Confirmed:"
const NOTES_LEAD =
  /^(?:what i |i |also |already )?(?:verified|confirmed|checked|reviewed|tested|tests?|validation|passed|resolved|closed|fixed|context|notes?|summary|coverage|scope|ran|not run|residual|follow[- ]?ups?|open questions?|assumptions?)\b/i
const NONE = /^(?:\*\*|__)?\s*(?:none|no\b|nothing|n\/a|not applicable|clean\b)/i
// The answer says outright there is nothing to fix.
const CLEAN =
  /^(?:yes\b[\s,.—–-]*)?(?:i\s+)?(?:(?:found|see|have|there\s+(?:are|is))\s+)?(?:no\s+(?:[\w/'-]+\s+){0,6}?(?:findings?|blockers?|issues?|defects?|bugs?|concerns?|regressions?|problems?|violations?|gaps?|p0s?|p1s?|behaviou?r)\b|none\b|nothing\s+(?:to|left|further|blocking|new)\b|lgtm\b|looks good\b|clean\b|blockers?\s*:\s*none\b|(?:all|both|the)\s+(?:[\w-]+\s+){0,5}?(?:findings?|issues?|defects?|cases|items?)\s+(?:(?:is|are|now)\s+)*(?:\*\*)?(?:resolved|closed|fixed|addressed)\b)/i
// "No blockers, but two issues remain" is not a clean answer.
const TURNS = /\b(?:but|however|except|although|though)\b/i
const DECLARED = /^[\s>#*_-]*(?:final\s+)?verdict\s*[:=—–-]\s*[*_`"']*\s*([a-z][a-z -]{0,30})/im
const SHIP_WORDS = /^(ship|ships|shipped|approve|approved|lgtm|pass|passes|accept|accepted|clean|go\b|ok\b|okay|ready)/i
const REVISE_WORDS = /^(revise|iterate|rework|changes?|fix|block|blocked|reject|rejected|hold|no[- ]?go|not\s+ready|needs?|request)/i
const OPENS_SHIP = /^(?:\*\*|__)?\s*(?:ship(?:\s+it)?|lgtm|approved?)\b\s*(?:\*\*|__)?\s*(?:[.!:,—–-]|$)/i
const OPENS_REVISE = /^(?:\*\*|__)?\s*(?:request(?:ing)? changes|revise|iterate|do not (?:ship|merge)|don't (?:ship|merge)|not ready)\b/i

// Route folders count as path segments: `src/app/(app)/[id]/page.tsx`. A
// bracket or parenthesis only ever wraps a whole segment, so "(see x.ts:3)"
// and "[x.ts:3]" still read as x.ts:3.
const SEGMENT = '(?:\\([\\w.-]+\\)|\\[[\\w.-]+\\]|[\\w@.~-]+)'
const FILE = '(?:\\[[\\w.-]+\\]|[\\w@-])(?:\\[[\\w.-]+\\]|[\\w@.-])*'
const PATH = `(?:${SEGMENT}\\/)*${FILE}\\.[A-Za-z][A-Za-z0-9]{0,5}`
const LINES = ':\\d+(?:[-–]\\d+)?(?:,\\s*\\d+(?:[-–]\\d+)?)*'
// "[AppModel.swift:751](/abs/AppModel.swift:751)", "[taps.ts](/abs/taps.ts:190)"
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/
const LINK_ALL = /\[([^\]\n]+)\]\(([^)\s]+)\)/g
const SPAN_LOCATION = new RegExp(`^\`(${PATH}(?:${LINES})?)\``)
const BRACKET_LOCATION = /^\[([^\]\n]{1,120})\](?!\()/
const BARE_LOCATION = new RegExp(`^(${PATH}${LINES})`)
const ANY_LOCATION = new RegExp(`\`?(${PATH}${LINES})\`?`)

// "[taps.ts](/abs/path/taps.ts:190)" reads "taps.ts:190"; a web link stays a link.
function linkText(label: string, href: string): string {
  if (/^https?:/i.test(href)) return `[${label}](${href})`
  const text = label.replace(/`/g, '')
  if (/:\d/.test(text) || /^\d+(?:[-–]\d+)?$/.test(text)) return text
  const line = /:(\d+(?:[-–]\d+)?)$/.exec(href)?.[1]
  return line ? `${text}:${line}` : text
}

const tidy = (text: string): string =>
  text
    .replace(LINK_ALL, (_whole, label: string, href: string) => linkText(label, href))
    .replace(/\s+/g, ' ')
    .trim()

// Splits "`src/x.ts:10` — text" into where and what.
function takeLocation(raw: string): { location: string | null; text: string } {
  let rest = raw.trim()
  let location: string | null = null
  const link = LINK.exec(rest)
  if (link && link.index === 0 && !/^https?:/i.test(link[2] ?? '')) {
    location = linkText(link[1] ?? '', link[2] ?? '')
    rest = rest.slice(link[0].length)
    const range = /^[-–]\d+/.exec(rest)
    if (range) {
      location += range[0]
      rest = rest.slice(range[0].length)
    }
  } else {
    const found = SPAN_LOCATION.exec(rest) ?? BARE_LOCATION.exec(rest) ?? BRACKET_LOCATION.exec(rest)
    if (found) {
      location = (found[1] ?? '').trim()
      rest = rest.slice(found[0].length)
    }
  }
  if (location !== null) rest = rest.replace(/^\s*(?:\*\*|__)?\s*(?:[—–:,]|-(?=\s))?\s*/, '')
  const text = tidy(rest)
  if (location === null) {
    const inner = LINK.exec(rest)
    location =
      inner && !/^https?:/i.test(inner[2] ?? '') && /\.[A-Za-z]/.test(inner[2] ?? '')
        ? linkText(inner[1] ?? '', inner[2] ?? '')
        : (ANY_LOCATION.exec(text)?.[1] ?? null)
  }
  return { location, text }
}

// The severity a line opens with, when it is marked as one and not just a word
// of the sentence ("Important changes were made" is prose).
function takeTag(raw: string): { severity: Severity; rest: string } | null {
  const tag = TAG.exec(raw)
  if (!tag) return null
  const word = (tag[3] ?? '').toLowerCase()
  const isMarked = Boolean(tag[1] || tag[2] || tag[5] || tag[6]) || /^p\d$/.test(word)
  if (!isMarked) return null
  let rest = tag[7] ?? ''
  // "**High — title.** text" closes its bold after the title.
  if (tag[1] && !tag[5]) rest = rest.replace(/\*\*|__/, '')
  return { severity: SEVERITY_WORDS[word] ?? 'important', rest }
}

const leadSeverity = (line: string): Severity | null => {
  if (/\bnon[- ]?blocking\b/i.test(line)) return 'nit'
  const word = new RegExp(`\\b(${SEVERITY})\\b`, 'i').exec(line)?.[1]?.toLowerCase()
  return word ? (SEVERITY_WORDS[word] ?? null) : null
}

function fromEnvelope(result: string): Answer | null {
  if (!result.startsWith('{')) return null
  try {
    const parsed = JSON.parse(result) as {
      verdict?: string
      summary?: string
      findings?: { severity?: string; title?: string; rationale?: string; location?: string | null }[]
    }
    if (typeof parsed.verdict !== 'string' || !Array.isArray(parsed.findings)) return null
    const findings = parsed.findings.map(finding => ({
      severity: SEVERITY_WORDS[String(finding.severity).toLowerCase()] ?? 'important',
      location: finding.location ? String(finding.location) : null,
      text: tidy(String(finding.title ?? finding.rationale ?? '')),
      detail: finding.title && finding.rationale ? tidy(String(finding.rationale)) : null,
    }))
    const verdict: Verdict = parsed.verdict === 'ship' ? 'ship' : parsed.verdict === 'iterate' ? 'revise' : 'none'
    return { verdict, source: 'json', findings, summary: parsed.summary ? String(parsed.summary) : null }
  } catch {
    return null
  }
}

type Mode = 'neutral' | 'findings' | 'notes' | 'section'

const opensWithLocation = (body: string): boolean =>
  SPAN_LOCATION.test(body) || BARE_LOCATION.test(body) || (LINK.exec(body)?.index === 0 && !/^\[[^\]]*\]\(https?:/i.test(body))

// How freely a list is read as findings depends on what was asked:
// `diff` is PaF's own review of a diff, where a list under any heading is
// findings; `review` is a prompt that asks for one, where a list item must open
// with a location or a severity; `other` needs the severity or a lead-in.
export type Asked = 'diff' | 'review' | 'other'

export function parseAnswer(result: string | null, asked: Asked = 'diff'): Answer {
  const isReview = asked !== 'other'
  const text = (result ?? '').trim()
  if (text === '') return { verdict: 'none', source: null, findings: [], summary: null }
  const envelope = fromEnvelope(text)
  if (envelope) return envelope

  const findings: Finding[] = []
  const prose: string[] = []
  let mode: Mode = 'neutral'
  let lead: Severity | null = null
  let open: Finding | null = null
  let isFenced = false

  const add = (severity: Severity, raw: string): void => {
    const { location, text: body } = takeLocation(raw)
    if (body === '' && location === null) return
    open = { severity, location, text: body, detail: null }
    findings.push(open)
  }
  const extend = (raw: string): void => {
    if (!open) return
    const more = tidy(raw.replace(LIST_ITEM, '$2'))
    if (more === '') return
    if (open.text === '') open.text = more
    else open.detail = open.detail ? `${open.detail} ${more}` : more
    if (open.location === null) open.location = ANY_LOCATION.exec(more)?.[1] ?? null
  }

  // What a heading or a lead-in line says the lines under it are.
  const enter = (label: string): Mode => {
    const bare = label.replace(/[*_`]/g, '').trim()
    if (NOTES_LEAD.test(bare)) return 'notes'
    if (FINDINGS_LEAD.test(bare) && !/^no\b/i.test(bare)) {
      lead = /\bhard\b/i.test(bare) ? 'blocker' : leadSeverity(bare)
      return 'findings'
    }
    lead = null
    return 'section'
  }
  // A heading keeps its say until the next one; a lead-in line only until prose resumes.
  let isSticky = false

  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) {
      isFenced = !isFenced
      if (!open) prose.push(raw)
      continue
    }
    if (isFenced) {
      if (!open) prose.push(raw)
      continue
    }
    if (raw.trim() === '') {
      prose.push('')
      continue
    }
    const indent = /^\s*/.exec(raw)?.[0].length ?? 0
    const heading = HEADING.exec(raw)
    if (heading) {
      open = null
      mode = enter(heading[1] ?? '')
      isSticky = true
      continue
    }
    if (DECLARED.test(raw) && findings.length === 0) continue

    const item = LIST_ITEM.exec(raw)
    if (item) {
      const body = item[2] ?? ''
      // An indented item belongs to the finding above it.
      if (indent >= 2 && open) {
        extend(body)
        continue
      }
      const tag = mode === 'notes' ? null : takeTag(body)
      if (tag) {
        add(tag.severity, tag.rest)
      } else if (NONE.test(body)) {
        open = null
      } else if (body.split(/\s+/).length <= 6 && !/[.!?:]\s/.test(body) && FINDINGS_LEAD.test(body)) {
        // "2) BLOCKING objections" is a heading written as a list item.
        open = null
        mode = enter(body)
        isSticky = true
      } else if (mode === 'findings' || (mode === 'section' && asked === 'diff')) {
        add(lead ?? 'finding', body)
      } else if (mode === 'neutral' && isReview && opensWithLocation(body)) {
        add('finding', body)
      } else {
        open = null
        prose.push(raw)
      }
      continue
    }

    if (indent >= 2 && open) {
      extend(raw)
      continue
    }
    const line = raw.trim()
    const tag = mode === 'notes' ? null : takeTag(line)
    if (tag) {
      add(tag.severity, tag.rest)
      continue
    }

    const bold = BOLD_LEAD.exec(line)
    if (bold && open && (bold[2] ?? '') !== '' && WHERE_LABEL.test(bold[1] ?? '')) {
      const finding: Finding = open
      if (finding.location === null) finding.location = tidy(bold[2] ?? '').replace(/[.;]\s*$/, '').slice(0, 60)
      continue
    }
    if (bold && (bold[2] ?? '') === '' && (bold[1] ?? '').split(/\s+/).length <= 8) {
      // A line that is all bold is a heading by another spelling.
      open = null
      mode = enter(bold[1] ?? '')
      isSticky = true
      continue
    }
    if (bold && mode !== 'notes') {
      const label = bold[1] ?? ''
      const rest = bold[2] ?? ''
      if (BOLD_NOUN.test(label) && !NEGATED.test(label.split(/[—–:]/)[0] ?? '')) {
        if (NONE.test(rest) || CLEAN.test(rest)) {
          open = null
          prose.push(raw)
          continue
        }
        // What follows a dash inside the bold is the finding's own words.
        const own = (/[—–]\s*(.+)$/.exec(label)?.[1] ?? '').replace(/^(?:hard|soft)\s*[:.]?\s*$/i, '')
        const severity = /\bhard\b/i.test(label) ? 'blocker' : /\bsoft\b/i.test(label) ? 'nit' : (leadSeverity(label) ?? 'finding')
        add(severity, `${own} ${rest}`.trim())
        continue
      }
      if (mode === 'findings') {
        add(lead ?? 'finding', line)
        continue
      }
    }

    const told = mode !== 'notes' && isReview ? PROSE_DEFECT.exec(line) : null
    if (told) {
      add('finding', told[1] ?? '')
      continue
    }
    const inline = mode === 'notes' ? null : INLINE_LEAD.exec(line)
    if (inline && !NONE.test(inline[2] ?? '') && !NEGATED.test(line.slice(0, line.indexOf(':')))) {
      const named = /blocker/i.test(inline[1] ?? '') ? 'blocker' : leadSeverity(line.slice(0, line.indexOf(':')))
      add(named ?? 'finding', inline[2] ?? '')
      if (!isSticky) mode = 'neutral'
      continue
    }
    open = null
    if (/:\s*$/.test(line) || OPENS_REVISE.test(line) || LEAD_SENTENCE.test(line)) {
      const next = NEGATED.test(line) && !OPENS_REVISE.test(line) ? 'neutral' : enter(line)
      mode = next === 'section' ? 'neutral' : next
      isSticky = false
      if (mode !== 'neutral') continue
    } else if (!isSticky) {
      mode = 'neutral'
    }
    prose.push(raw)
  }

  const head = text.slice(0, 600)
  const first = text.split('\n').find(line => line.trim() !== '' && !HEADING.test(line)) ?? ''
  // "**Spec review:** I found no hard violation" opens with a label, then says it.
  const opening = first.trim().replace(/^\*\*[^*]{0,48}:\*\*\s*/, '').replace(/^(?:\*\*|__)\s*/, '')
  const isClean = CLEAN.test(opening) && !TURNS.test(opening.split(/[.!?](?:\s|$)/)[0] ?? '')
  const word = DECLARED.exec(head)?.[1]?.trim() ?? null
  // A long list nobody rated or located is a plan or an essay, not a review.
  if (findings.length > 10 && findings.filter(finding => finding.location !== null || finding.severity !== 'finding').length * 2 < findings.length) {
    return { verdict: 'none', source: null, findings: [], summary: text }
  }
  const hasDefect = findings.some(finding => finding.severity !== 'nit')
  // "approve, with revisions before implementation" is not a ship.
  const isQualified = /\b(?:with|but|after|once|pending|except|before|provided)\b/i.test(DECLARED.exec(head)?.[0] ? (head.split('\n').find(line => DECLARED.test(line)) ?? '') : '')

  let verdict: Verdict = 'none'
  let source: VerdictSource | null = null
  if (word !== null && SHIP_WORDS.test(word)) {
    verdict = isQualified && hasDefect ? 'revise' : 'ship'
    source = 'declared'
  } else if (word !== null && REVISE_WORDS.test(word)) {
    verdict = 'revise'
    source = 'declared'
  } else if (OPENS_SHIP.test(opening) && !hasDefect) {
    verdict = 'ship'
    source = 'declared'
  } else if (OPENS_REVISE.test(opening)) {
    verdict = 'revise'
    source = 'declared'
  } else if (hasDefect) {
    verdict = 'revise'
    source = 'inferred'
  } else if (isClean || findings.length > 0) {
    // Nothing but nits is a ship, as PaF's own verdict rule has it.
    verdict = 'ship'
    source = 'inferred'
  }


  const summary = prose.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { verdict, source, findings, summary: summary === '' ? null : summary }
}

export function worstOf(findings: readonly Finding[]): Severity | null {
  let worst: Severity | null = null
  for (const finding of findings) {
    if (worst === null || RANK[finding.severity] < RANK[worst]) worst = finding.severity
  }
  return worst
}

// "1 blocker · 2 important · 1 nit"
export function countsText(findings: readonly Finding[]): string {
  const count = { blocker: 0, important: 0, finding: 0, nit: 0 }
  for (const finding of findings) count[finding.severity] += 1
  const parts: string[] = []
  if (count.blocker) parts.push(`${count.blocker} blocker${count.blocker === 1 ? '' : 's'}`)
  if (count.important) parts.push(`${count.important} important`)
  if (count.finding) parts.push(`${count.finding} finding${count.finding === 1 ? '' : 's'}`)
  if (count.nit) parts.push(`${count.nit} nit${count.nit === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------- failures

// Lines a backend prints before the one that says what went wrong.
const NOISE = [/^reading additional input from stdin/i, /^yolo mode is enabled/i, /^stderr:\s*$/i, /^warning:/i, /^\(node:\d+\)/i, /^loaded cached credentials/i]

const KNOWN: [RegExp, string, string][] = [
  [/no rollout found for thread|thread\/resume failed/i, 'session lost', 'Codex no longer has this session. Start the next round under a new --session label.'],
  [/timed out after \d+\s*s/i, 'timed out', 'The backend ran out of time. Raise the timeout, or ask for less in one round.'],
  [/git diff is too large/i, 'diff too large', 'The diff is over the review limit. Narrow the scope, or review commit by commit.'],
  [/completed without producing output|no output produced|empty (?:answer|response)/i, 'no output', 'The backend finished with nothing to say, which often means a tool call was denied.'],
  [/owner process exited/i, 'interrupted', 'The phone-a-friend process was stopped before the answer came back.'],
  [/belongs to a different repo|different repository/i, 'wrong repo', 'This session label is tied to another repository. Use a new label here.'],
  [/error authenticating|not logged in|unauthorized|\b401\b|ineligibletier/i, 'not signed in', 'The backend is not signed in. Run phone-a-friend doctor.'],
  [/rate limit|\b429\b|quota|usage limit/i, 'rate limited', 'The backend hit a usage limit. Try again later, or ask another backend.'],
  [/connection error|econnrefused|fetch failed/i, 'unreachable', 'The backend could not be reached. Check that its server is running.'],
  [/verdict parse failed/i, 'unreadable verdict', 'The answer did not fit the verdict format. Ask again, or drop --verdict-json.'],
]

export function explain(error: string | null, status: string): Problem | null {
  if (status !== 'failed' && status !== 'interrupted') return null
  const whole = error ?? ''
  const lines = whole
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !NOISE.some(noise => noise.test(line)))
  const line = (lines[0] ?? (status === 'interrupted' ? 'Interrupted before it finished.' : 'Failed without an error message.'))
    .replace(/^(?:error|stderr):\s*/i, '')
    .replace(/^runtime task [0-9a-f-]{8,} failed:\s*/i, '')
  const known = KNOWN.find(([pattern]) => pattern.test(whole))
  return { label: known?.[1] ?? (status === 'interrupted' ? 'interrupted' : 'failed'), line, hint: known?.[2] ?? null }
}

// ---------------------------------------------------------------- rounds

const DEFAULT_REVIEW = /^(?:please\s+)?review\s+(?:the\s+|this\s+)?(?:changes|diff|branch\s+\S+\s+(?:against|vs)|working tree|code)\b/i
const ROUND_HEAD =
  /^((?:round|pass|gate|phase|step|iteration)\s+[\w.]+(?:,\s*(?:pass|round)\s+\w+)?(?:\s*\([^)]{1,24}\))?(?:\s+(?:for|on|of)\s+[^.:;,]{1,40}?)?)\s*(?:[.:;,—–-]\s|$)/i
const LABEL_PREFIX = /^(?:user request|request|task|question|prompt|context)\s*:\s*/i
const TITLE_CHARS = 46

const askedOf = (task: PafTask): Asked =>
  task.kind === 'review'
    ? 'diff'
    : /\b(review|round|pass|gate|findings?|defects?|verdict|sign[- ]off|blockers?)\b/i.test(task.promptPreview ?? '')
      ? 'review'
      : 'other'

// The opening clause of the prompt names the round: "Round 3 for #400",
// "Gate A, pass 2", "Delta after your ship at b86b56f".
export function titleOf(prompt: string, kind: string, reviewScope: string | null, backend: string): string {
  const preview = prompt.replace(/\s+/g, ' ').trim().replace(LABEL_PREFIX, '')
  if (preview === '' || DEFAULT_REVIEW.test(preview)) {
    if (kind === 'review' || preview !== '') {
      return reviewScope === 'working-tree' ? 'Working tree review' : reviewScope === 'all' ? 'Review of all changes' : 'Branch review'
    }
    return `${backend} ${kind}`
  }
  let title = ROUND_HEAD.exec(preview)?.[1] ?? null
  if (title === null) {
    title = preview
    const sentence = /[.!?](?:\s|$)/.exec(title)
    if (sentence && sentence.index >= 8) title = title.slice(0, sentence.index)
    const colon = title.indexOf(': ')
    if (colon >= 6 && colon <= TITLE_CHARS && !title.slice(0, colon).includes('(')) title = title.slice(0, colon)
  }
  title = title.replace(/[\s,;:—–-]+$/, '')
  if (title.length > TITLE_CHARS) {
    const cut = title.slice(0, TITLE_CHARS)
    const space = cut.lastIndexOf(' ')
    title = (space > 28 ? cut.slice(0, space) : cut).replace(/[\s,;:(—–-]+$/, '')
    // Stop before a parenthesis the cut left open.
    const paren = title.lastIndexOf('(')
    title = paren > 12 && !title.slice(paren).includes(')') ? title.slice(0, paren).trim() : `${title}…`
  }
  // "ROUND 3 — final sign-off" reads better as a sentence.
  if (/^[A-Z]{4,}\b/.test(title)) {
    title = title.replace(/\b[A-Z]{4,}\b/g, word => word.toLowerCase())
    title = title.charAt(0).toUpperCase() + title.slice(1)
  }
  return title
}

export const roundTitle = (task: PafTask): string => titleOf(task.promptPreview ?? '', task.kind, task.reviewScope, task.backend)

// What the reviewer was asked beyond the title: the rest of the prompt PaF kept (its first 200 characters).
export function questionOf(round: Round): string {
  const preview = (round.task.promptPreview ?? '').replace(/\s+/g, ' ').trim().replace(LABEL_PREFIX, '')
  if (preview === '' || DEFAULT_REVIEW.test(preview)) return ''
  const title = round.title.replace(/…$/, '')
  const rest = preview.toLowerCase().startsWith(title.toLowerCase()) ? preview.slice(title.length) : preview
  return rest.replace(/^[\s.,;:!?—–-]+/, '').trim()
}

export function toRound(task: PafTask): Round {
  const answer = parseAnswer(task.result, askedOf(task))
  const problem = explain(task.error, task.status)
  let state: RoundState
  if (isActive(task)) state = 'live'
  else if (problem !== null) state = 'failed'
  else if (answer.verdict === 'ship') state = 'ship'
  else if (answer.verdict === 'revise') state = 'revise'
  else state = 'answered'
  return {
    task,
    title: roundTitle(task),
    state,
    answer,
    worst: worstOf(answer.findings),
    problem,
    startedAt: parseTime(task.startedAt) ?? parseTime(task.createdAt),
    finishedAt: parseTime(task.finishedAt),
  }
}

// Parsing an answer is the costly part and a finished task never changes, so
// rounds are kept by task id and by what would change them.
const kept = new Map<string, { stamp: string; round: Round }>()

export function roundOf(task: PafTask): Round {
  const stamp = `${task.status}|${task.finishedAt ?? ''}|${task.result?.length ?? 0}|${task.error?.length ?? 0}`
  const hit = kept.get(task.id)
  if (hit && hit.stamp === stamp) return hit.round.task === task ? hit.round : { ...hit.round, task }
  const round = toRound(task)
  if (kept.size > 600) kept.clear()
  kept.set(task.id, { stamp, round })
  return round
}

// ---------------------------------------------------------------- threads

// ".herdr/worktrees/<repo>/worktree-green-river-fb03" is repo + "green-river".
export function placeOf(path: string | null): { repo: string; worktree: string | null } {
  if (!path) return { repo: 'unknown', worktree: null }
  const parts = path.split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? path
  const marker = parts.findIndex(part => part === 'worktrees' || part === 'workspaces')
  if (marker >= 0 && parts.length > marker + 1) {
    // "<repo>/.claude/worktrees/<name>" is a worktree of <repo>.
    if (marker >= 2 && parts[marker - 1]?.startsWith('.') && parts[marker - 1] !== '.herdr') {
      return { repo: parts[marker - 2] ?? last, worktree: parts[marker + 1] ?? null }
    }
    if (parts.length > marker + 2) {
      const name = (parts[marker + 2] ?? '').replace(/^worktree-/, '').replace(/-[0-9a-f]{4}$/, '')
      return { repo: parts[marker + 1] ?? last, worktree: name || null }
    }
  }
  return { repo: last, worktree: null }
}

// Everything asked about one branch is one thread, whoever was asked.
export function toThreads(tasks: readonly PafTask[]): Thread[] {
  const groups = new Map<string, PafTask[]>()
  for (const task of tasks) {
    const key = `${placeOf(task.repoPath).repo}:${task.branch ?? task.repoPath ?? ''}`
    const group = groups.get(key)
    if (group) group.push(task)
    else groups.set(key, [task])
  }

  const threads: Thread[] = []
  for (const [key, group] of groups) {
    const rounds = group.map(roundOf).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    const last = rounds[rounds.length - 1]
    const first = rounds[0]
    if (!last || !first) continue
    const repo = placeOf(last.task.repoPath).repo
    threads.push({
      key,
      title: last.task.branch ?? repo,
      repo,
      backends: [...new Set(rounds.map(round => round.task.backend))],
      labels: [...new Set(rounds.map(round => round.task.sessionLabel).filter((label): label is string => label !== null))],
      rounds,
      state: rounds.some(round => round.state === 'live') ? 'live' : last.state,
      firstAt: first.startedAt ?? 0,
      lastAt: Math.max(...rounds.map(round => round.finishedAt ?? round.startedAt ?? 0)),
    })
  }
  return threads.sort((a, b) => Number(b.state === 'live') - Number(a.state === 'live') || b.lastAt - a.lastAt)
}

// How long this backend usually takes for this kind of call: the median of the finished ones.
export function usualMs(tasks: readonly PafTask[], like: PafTask): number | null {
  const runs = tasks
    .filter(task => task.status === 'completed' && task.backend === like.backend && task.kind === like.kind)
    .map(task => {
      const started = parseTime(task.startedAt)
      const finished = parseTime(task.finishedAt)
      return started !== null && finished !== null ? finished - started : null
    })
    .filter((ms): ms is number => ms !== null && ms > 0)
    .sort((a, b) => a - b)
  if (runs.length < 3) return null
  return runs[Math.floor(runs.length / 2)] ?? null
}

// What to hand Claude when the person asks for a round to be acted on.
export function handoff(thread: Thread, round: Round): string {
  const number = thread.rounds.indexOf(round) + 1
  const lines = [`phone-a-friend: ${round.task.backend} answered "${round.title}" (${thread.title}, round ${number}, task ${round.task.id}).`]
  if (round.answer.source !== 'inferred' && round.answer.verdict !== 'none') lines.push(`Verdict: ${round.answer.verdict}.`)
  if (round.answer.findings.length > 0) {
    lines.push('', 'Findings:')
    for (const finding of round.answer.findings) {
      lines.push(`- [${finding.severity}]${finding.location ? ` [${finding.location}]` : ''} ${finding.text}${finding.detail ? ` ${finding.detail}` : ''}`)
    }
    lines.push('', 'Check each finding against the code before acting on it, then fix the ones that hold.')
  } else {
    lines.push('', round.task.result ?? round.problem?.line ?? '')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- agents

export type AgentState = 'blocked' | 'done' | 'working' | 'idle' | 'unknown'
// What wants the person first.
const AGENT_ORDER: AgentState[] = ['blocked', 'done', 'working', 'idle', 'unknown']

export type AgentCard = {
  agent: HerdrAgent
  state: AgentState
  // What the session is about: its terminal title.
  topic: string
  repo: string
  worktree: string | null
  isHere: boolean
  since: number | null
}

// Where this session is: its worktree, and its own pane when herdr runs it.
export type Here = { root: string; pane: string | null }

export const isInside = (path: string | null, root: string): boolean => path !== null && (path === root || path.startsWith(`${root}/`))

// Whether a pane is this very session: by its id when herdr gave one, else by where it works.
export const isSelf = (agent: HerdrAgent, here: Here): boolean => (here.pane !== null ? agent.id === here.pane : isInside(agent.cwd, here.root))

export function toAgentCards(agents: readonly HerdrAgent[], since: Record<string, number>, here: Here): AgentCard[] {
  return agents
    .map(agent => {
      const state = (AGENT_ORDER.includes(agent.status as AgentState) ? agent.status : 'unknown') as AgentState
      const place = placeOf(agent.cwd)
      return {
        agent,
        state,
        topic: agent.title.replace(/^[^\p{L}\p{N}]+/u, '').trim() || `${agent.agent} session`,
        repo: agent.repo ?? place.repo,
        worktree: place.worktree,
        isHere: isSelf(agent, here),
        since: since[agent.id] ?? null,
      }
    })
    .sort(
      (a, b) =>
        AGENT_ORDER.indexOf(a.state) - AGENT_ORDER.indexOf(b.state) ||
        Number(b.isHere) - Number(a.isHere) ||
        (a.agent.number ?? 99) - (b.agent.number ?? 99),
    )
}

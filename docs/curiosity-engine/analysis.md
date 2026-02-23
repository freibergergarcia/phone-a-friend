# Curiosity Engine — Cross-Backend Session Analysis

> **Scope:** Based exclusively on four live Curiosity Engine sessions run on
> February 23, 2026 between Claude (Sonnet 4.6) and three backends: Codex,
> Gemini (gemini-2.5-flash), and Ollama (gemma3:4b). No external benchmarks
> or third-party data were used.

---

## Sessions Analyzed

| # | Topic | Backend | Rounds to convergence | Schema violations |
|---|---|---|---|---|
| 1 | "which AI has the strongest reasoning" | Codex | **4** | None |
| 2 | "how to climb to Machu Picchu the most efficiently" | Codex | **4** | None |
| 3 | "how to climb to Machu Picchu the most efficiently" | Gemini (gemini-2.5-flash) | **5** | None |
| 4 | "how to climb to Machu Picchu the most efficiently" | Ollama (gemma3:4b) | **5** | None |

All four sessions converged. No re-prompts were triggered in any session.

---

## Speed to Core Answer — Who Got There First?

In every session, the **backend model** (not Claude) delivered the core answer
in Round 1. Claude served the opening question in all four sessions, giving the
backend first-mover advantage on substantive claims.

| Session | Backend | Core answer delivered at | What they said |
|---|---|---|---|
| 1 | Codex | Round 1 | "o-series leads on benchmarks; for hard open-ended problems, trust model-plus-process, not a single model run" |
| 2 | Codex | Round 1 | "Train + bus wins. Biggest mistake: not locking the entry circuit/slot first — that's what makes trips fail" |
| 3 | Gemini | Round 1 | "Train to Aguas Calientes + bus. The bottleneck is booking train and entry tickets well in advance" |
| 4 | Ollama | Round 1 | "Train-to-bus via Aguas Calientes minimizes elapsed time — 3-4 hours vs 4-5 days for the Inca Trail" |

Claude did not independently assert a complete position until Round 2 (partial)
or Round 3–5 (full synthesis) in every session.

---

## Rounds to Convergence — Cross-Backend

| Backend | Rounds | Pattern |
|---|---|---|
| Codex | **4** | Anchor (R1) → refinement (R2-3) → synthesis (R4) |
| Gemini | **5** | Anchor (R1) → new angle introduced by Claude (R2-3) → validation (R4) → explicit synthesis (R5) |
| Ollama | **5** | Anchor (R1) → progressive refinement (R2-4) → playbook confirmed (R5) |

Codex converged one round faster than the other two backends. Gemini and Ollama
both required 5 rounds. The difference appears driven by conversational depth:
Claude introduced more novel angles with Gemini (Ollantaytambo bypass, Santa
Teresa backdoor route), extending the session productively. With Ollama, the
extra round was needed to achieve an explicit synthesis rather than an implied one.

---

## Schema Compliance

All three backends followed the `ANSWER:` / `QUESTION:` format correctly in
every round across all four sessions. The enforcement mechanism (re-prompt on
violation, early termination on second violation) was **never triggered**.

This is a meaningful result: all three backends — a closed coding-optimized
model (Codex), a frontier multimodal model (Gemini), and a 4B-parameter local
model (Ollama) — reliably followed the strict two-field schema with no
exceptions.

---

## Curiosity Quality — Which Model Asked Better Questions?

### Claude (as server across all sessions)

Claude's strongest questions introduced genuinely new angles rather than
extending the prior thread:

- "Is the o-series vs Claude extended thinking an architectural difference or
  just branding?" (Session 1, R2) — forced Codex to take a precise stance
- "Could a traveler route through Ollantaytambo (2,800m) instead of Cusco
  (3,400m) to reduce peak altitude exposure?" (Session 3, R3) — a tactical
  pivot neither model had raised; Gemini validated it strongly
- "Is Inca Rail vs Peru Rail a meaningful quality difference or just
  marketing?" (Session 2, R3) — challenged conventional travel advice
- "Does hiking up from Aguas Calientes on foot beat queueing for the bus
  during peak periods?" (Session 4, R4) — counterintuitive, with a
  quantitative answer (depart 4:30 AM, arrive at gate before first bus wave)

Claude's weakest questions were the synthesis prompts (e.g., "write the 3-day
itinerary in one sentence per day") — useful for forcing closure but not
genuinely curious.

### Codex (Sessions 1 & 2)

Codex asked the sharpest questions of any backend:

- "What single evaluation best predicts real-world hard-problem reliability —
  and how would you prevent leaderboard overfitting?" (S1, R1) — immediately
  elevated from "which model wins" to "how do you even measure this"
- "Which bottleneck matters most: search policies, verifiers/reward models, or
  synthetic reasoning data?" (S1, R3) — three-way forced choice, precise

Codex's questions were operationally tight and stress-tested the weakest point
of each prior answer.

### Gemini (Session 3)

Gemini's questions were logically sequential and practically useful, but
predictable — they followed the natural next step rather than introducing
surprising constraints. Questions circled through: alternative routes →
acclimatization → medications → non-pharmacological methods → booking
strategies. Methodical, not inventive.

### Ollama / gemma3:4b (Session 4)

Ollama's questions were the least probing. Three out of five returned to
acclimatization and fitness level variation, covering similar ground repeatedly.
Questions were clarifying rather than drilling. Ollama never pushed into booking
mechanics, crowd management policy, or entry circuit logistics — areas Codex
and Gemini both surfaced unprompted.

### Curiosity ranking

| Rank | Model | Characterization |
|---|---|---|
| 1 | **Codex** | Operationally tight; immediately elevated to harder meta-problems |
| 2 | **Claude** | Strategically inventive; introduced the sharpest new angles |
| 3 | **Gemini** | Logically sequential; practically useful but predictable |
| 4 | **Ollama (gemma3:4b)** | Topically relevant; repetitive; safe rather than probing |

---

## What Each Backend Contributed Uniquely

| Backend | Unique contribution |
|---|---|
| Codex | "Book the entry circuit/slot FIRST — that's what makes trips fail." Clean, counterintuitive, immediately actionable. Also: Guardian's House routing as the optimal first-stop on Circuit 2A. |
| Gemini | Validated Claude's Ollantaytambo altitude bypass (2,800m vs 3,400m Cusco) as "highly viable and recommended." Confirmed Santa Teresa / Hidroelectrica as a structural alternative to the PeruRail/Inca Rail monopoly. |
| Ollama | Consistently identified skipping Cusco acclimatization as the single most common traveler error — a physiological framing the other backends didn't foreground. |

---

## Focus Divergence Across Backends

The three backends on the Machu Picchu topic emphasized different failure modes,
despite converging on the same core route recommendation:

| Backend | Primary failure mode identified |
|---|---|
| Codex | **Booking logistics** — entry circuit/time slot not locked first |
| Gemini | **Booking logistics** — train + entry ticket advance booking as binding constraint |
| Ollama | **Physiological readiness** — skipping Cusco acclimatization |

Codex and Gemini converged on the same failure mode (booking). Ollama diverged
toward physiology. This may reflect gemma3:4b's training distribution — a 4B
local model that skews toward health and fitness content in travel queries —
rather than a difference in the underlying truth. Both failure modes are real;
the backends simply had different priors about which was primary.

---

## Summary Table — All Four Sessions

| Metric | S1 Codex (AI) | S2 Codex (MP) | S3 Gemini (MP) | S4 Ollama (MP) |
|---|---|---|---|---|
| Rounds to convergence | 4 | 4 | 5 | 5 |
| Backend answered first | ✅ R1 | ✅ R1 | ✅ R1 | ✅ R1 |
| Claude asserted position | R2 partial | R2 partial | R5 | R3 |
| Schema violations | 0 | 0 | 0 | 0 |
| Re-prompts needed | 0 | 0 | 0 | 0 |
| Most curious questioner | Codex | Claude | Claude | Claude |
| Most novel insight | Codex R1 | Codex R1 | Ollantaytambo bypass (Claude R3, Gemini validated) | Foot-trail beats bus queue (Claude R4) |

---

## Conclusions

**1. All backends converged. Schema compliance was universal.**
Codex, Gemini (7B-scale frontier), and Ollama (4B local) all followed the
`ANSWER:` / `QUESTION:` schema without a single violation across 18 combined
rounds. The curiosity engine's schema enforcement is robust across model scales
and providers.

**2. Codex converged fastest (4 rounds); Gemini and Ollama took 5.**
The difference was not breakdown — all three converged cleanly. Codex's edge
appears to come from answer precision: it gave the most complete and actionable
Round 1 response, requiring less refinement across subsequent rounds.

**3. The backend always answered first. Claude's structural role is probing.**
In all four sessions, the backend delivered the core answer in Round 1. Claude's
value was not speed — it was the quality of follow-up questions that extracted
depth and novel angles. The curiosity engine's server/receiver asymmetry is a
consistent structural feature, not a one-off artifact.

**4. Model scale correlates with question quality, but not perfectly.**
Codex > Claude > Gemini > Ollama on question curiosity. But Gemini (a larger,
frontier-class model) ranked below Claude — suggesting that the question-asking
role benefits more from creative framing than from raw model capability.

**5. Small local models can participate meaningfully.**
Ollama's gemma3:4b, running on local hardware, converged correctly, maintained
schema discipline, and produced the session's most concise "most common mistake"
answer. For low-stakes topics, small local models are viable curiosity engine
participants — they simply probe less inventively than frontier models.

**6. A serve-rotation variant would test whether backend first-mover advantage
is structural or coincidental.** In all four sessions, Claude served (asked
first). A future test should have the backend serve the first question to
determine whether Claude would similarly anchor the answer in Round 1.

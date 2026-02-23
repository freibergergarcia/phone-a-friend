# Curiosity Engine — Session Analysis

> **Scope:** This research is based exclusively on two live Curiosity Engine sessions
> run on February 23, 2026 between Claude (Sonnet 4.6) and Codex. No external
> benchmarks or third-party data were used.

---

## Sessions Analyzed

| # | Topic | Rounds to convergence | Status |
|---|---|---|---|
| 1 | "which AI has the strongest reasoning" | **4** | Converged ✅ |
| 2 | "how to climb to Machu Picchu the most efficiently" | **4** | Converged ✅ |

---

## Speed to Core Answer — Who Got There First?

### Session 1: AI Reasoning

**Codex reached the core answer at Round 1.**

Claude served the opening question. Codex's first response contained the full
directional answer:

> *"On benchmark-heavy reasoning, I'd currently give the edge to OpenAI's
> reasoning-focused o-series family, with top-tier Gemini and Claude variants
> very close in specific domains. For genuinely hard open-ended problems, I
> would not trust any single model run; I'd trust a model-plus-process setup."*

Claude's subsequent rounds were spent probing and refining — asking about
architectural differences, which lever matters most, and finally explicitly
requesting a concrete verdict in Round 4. Claude did not independently assert
a winner at any point; it validated and synthesized Codex's position.

### Session 2: Machu Picchu

**Codex reached the core answer at Round 1.**

Again, Claude served. Codex's first response contained both the route decision
and the most actionable insight of the entire session:

> *"The train-to-Aguas Calientes plus shuttle bus is the clear winner. The
> biggest planning mistake is obsessing over the route but not locking the
> Machu Picchu entry circuit/time slot first — which is what actually makes
> trips fail."*

The remaining three rounds were refinements (on-site routing, acclimatization
sequence, train operator choice, sleep location) that built on this foundation
without overturning it.

---

## Round-by-Round Agreement Progression

### Session 1

| Round | Agreement level | What changed |
|---|---|---|
| 1 | **Partial** — Codex named o-series; Claude had not yet stated a position | Codex anchored the answer |
| 2 | **Growing** — both agreed architectural diff is real but partly branding | Shared framing emerged |
| 3 | **Strong** — both agreed test-time compute / verification is the key lever | Core mechanism aligned |
| 4 | **Full** — Codex gave concrete verdict; Claude's implied position matched | Convergence declared |

### Session 2

| Round | Agreement level | What changed |
|---|---|---|
| 1 | **Partial** — Codex gave route + key insight; Claude had not yet stated a position | Codex anchored the answer |
| 2 | **Strong** — both aligned on Circuit 2A, early entry, Guardian's House first | On-site routing locked |
| 3 | **Strong** — both agreed timing > train brand; late Circuit 2 > switching | Logistics aligned |
| 4 | **Full** — identical 3-day plan produced independently | Convergence declared |

---

## Findings

### 1. Codex consistently reached the core answer first

In both sessions, Codex produced the key actionable insight in its **Round 1
response** — before Claude had stated any position of its own. Claude's role
across all 8 rounds was primarily to probe, challenge, and push for synthesis,
not to anchor answers.

This is consistent with the structural asymmetry of the Curiosity Engine: the
**serving model** (Claude) asks questions; the **receiving model** (Codex)
answers. Claude served in both sessions, giving Codex the first-mover advantage
on substantive claims.

### 2. Both sessions converged in exactly 4 rounds

Neither session required more than 4 rounds. The minimum-bar convergence
criterion ("same core conclusion") was met at Round 4 in both cases without
forcing agreement — the models arrived there naturally through the Q&A loop.

Rounds 1–2 established the anchor and first layer of refinement. Round 3
stress-tested the position. Round 4 produced the synthesis.

### 3. The most valuable insight appeared in Round 1 (not at convergence)

In both sessions, the highest-signal moment was Codex's Round 1 answer, not the
final convergence statement:

- **Session 1:** "Model-plus-process, not a single model run, is what you trust
  with a hard open-ended problem."
- **Session 2:** "Obsessing over the route but not locking the entry
  circuit/time slot first is what actually makes trips fail."

By Round 4, both models were re-stating and elaborating on these insights.
Convergence confirmed the answer — it did not discover it.

### 4. Claude's probing improved answer quality across rounds

While Codex landed the answer fastest, Claude's questioning improved the depth
and specificity of Codex's responses across rounds. Without Claude's probes
(on architectural differences, test-time compute, train operator choice,
acclimatization sequencing), Codex's Round 1 answers would have remained at
the directional level. The back-and-forth produced actionable detail that
neither model would have generated alone.

---

## Summary Table

| Metric | Session 1 (AI Reasoning) | Session 2 (Machu Picchu) |
|---|---|---|
| Rounds to convergence | 4 | 4 |
| Model that answered first | **Codex** (Round 1) | **Codex** (Round 1) |
| Round Claude first asserted a position | Round 2 (partial) | Round 2 (partial) |
| Round full agreement reached | Round 4 | Round 4 |
| Highest-signal round | Round 1 | Round 1 |
| Did Claude's probing add value? | Yes — depth and specificity | Yes — logistics detail |

---

## Conclusion

Across both sessions, **Codex reached the core answer faster** — consistently
in Round 1 — while **Claude drove the refinement** that turned a directional
answer into an actionable one. Full agreement was reached in **4 rounds** in
both cases, suggesting that 4 rounds is a natural convergence horizon for the
minimum-bar agreement criterion on topics of moderate complexity.

The Curiosity Engine's structural asymmetry (server asks, receiver answers)
gives the receiving model a systematic first-mover advantage on substantive
claims. A future variant could rotate the serve to test whether this advantage
holds when Claude answers first.

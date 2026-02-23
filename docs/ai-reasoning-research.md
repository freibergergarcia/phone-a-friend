# AI Reasoning Engine Comparison — Latest Models (February 2026)

> **Methodology:** Web searches conducted February 23, 2026. All figures sourced from official announcements, model cards, and live search results. Where multiple sources conflict, the most conservative or independently-verified figure is used. Scores marked with † are self-reported by the model developer.

---

## What's New Since January 2026

The last 4–6 weeks have been unusually active across all major AI labs:

- **Claude Sonnet 4.6** (Anthropic, ~February 20, 2026): Improved coding, computer use, long-context reasoning, agent planning, and knowledge work. Features a 1M-token context window (beta) at the same pricing as Sonnet 4.5. Described as the current production workhorse in the Claude family.
- **Gemini 3.1 Pro** (Google DeepMind, ~February 2026): Achieved a verified 77.1% on ARC-AGI-2, reportedly more than doubling the reasoning performance of Gemini 3 Pro on that benchmark.
- **Grok 3 / Grok 3 mini open-sourcing signal** (xAI, February 10, 2026): Elon Musk confirmed plans to open-source Grok 3. No date confirmed as of February 23, 2026.
- **DeepSeek R2 — imminent but not released**: Multiple sources anticipated a mid-February 2026 launch (around Lunar New Year). As of February 23, 2026, no official release has been published, though DeepSeek OCR 2 (January 27, 2026) previews multimodal capabilities expected in R2.
- **DeepSeek V3.2-Exp** (released September 2025, gaining traction in early 2026): Achieves 79.9% on GPQA Diamond and 67.8% on SWE-Bench Verified. Won gold-medal level at the 2025 IMO (35/42 points).
- **GPT-5.3-Codex** (OpenAI, ~February 2026): Described as an agentic coding model combining Codex + GPT-5 training stacks, approximately 25% faster than prior versions, setting new coding benchmarks.
- **NVIDIA Alpamayo** (January 2026): Family of open-source 10B-parameter chain-of-thought VLA models for autonomous vehicles — a niche but notable specialist reasoning release.

---

## Summary Table

All scores are pass@1 unless noted. "ET" = Extended Thinking mode. "-" = not publicly reported. Sorted by GPQA Diamond descending.

| Model | Developer | Release | GPQA Diamond | MATH-500 | AIME 2024 | AIME 2025 | Reasoning Approach |
|---|---|---|---|---|---|---|---|
| **o3** (full) | OpenAI | Apr 2025 | **87.7%** | ~97% | 91.6% | 88.9% | Chain-of-thought RL (o-series) |
| **Gemini 2.5 Pro** | Google DeepMind | Mar 2025 | **84.0%** | ~97% | 92.0% | 86.7% | Native thinking / long-CoT |
| **Claude 3.7 Sonnet (ET)** | Anthropic | Feb 2025 | **84.8%** | 96.2% | 80.0% | ~78% | Hybrid: standard + extended thinking |
| **Grok 3 (Think)** | xAI | Feb 2025 | **84.6%** | - | - | 93.3% (cons@64) | Large-scale RL chain-of-thought |
| **Grok 3 mini** | xAI | Feb 2025 | ~82% | - | 95.8% | - | Lightweight RL reasoning |
| **DeepSeek V3.2-Exp** | DeepSeek | Sep 2025 | **79.9%** | - | - | - | MoE + RL fine-tuning |
| **o3-mini (high)** | OpenAI | Jan 2025 | **79.7%** | ~97% | 87.3% | - | Efficient RL reasoning |
| **Claude 3.7 Sonnet (standard)** | Anthropic | Feb 2025 | **78.2%** | 96.2% | 61.3% | - | Standard transformer |
| **DeepSeek-R1** | DeepSeek | Jan 2025 | **71.5%** | 97.3% | 79.8% | - | Pure RL / GRPO |
| **o1** | OpenAI | Sep 2024 | **75.7%** | - | 74.3% | - | Chain-of-thought RL |
| **GPT-4.5** | OpenAI | Feb 2025 | ~72% | - | - | - | Standard (no native CoT) |
| **Gemini 2.0 Flash Thinking** | Google DeepMind | Jan 2025 | **74.2%** | - | 73.3% | - | Flash-scale thinking model |
| **Llama 4 Behemoth** (teacher) | Meta | Apr 2025 | Claims > 3.7 Sonnet | ~97% | - | - | MoE, disputed benchmarks |
| **Llama 4 Maverick** | Meta | Apr 2025 | - | - | - | - | MoE, 17B active / 128 experts |
| **GPT-4o** | OpenAI | May 2024 | ~53% | - | - | - | Standard multimodal |

> **Note on o4-mini**: OpenAI's o4-mini (released April 2025 alongside o3) achieves 99.5% pass@1 on AIME 2025 when given access to a Python interpreter (81.4% without tools on GPQA Diamond). It blurs the line between pure reasoning and tool-augmented performance.

---

## Model Family Deep Dives

---

### Anthropic — Claude Family

#### Claude 3.7 Sonnet (February 2025)

Claude 3.7 Sonnet is Anthropic's first **hybrid reasoning model**, meaning it can operate in standard mode (fast, direct answers) or in **extended thinking mode** (explicit chain-of-thought reasoning visible to the user). This is architecturally distinct from OpenAI's o-series: the thinking tokens are exposed, not hidden.

**Benchmark Scores:**

| Benchmark | Standard Mode | Extended Thinking (64K token budget) |
|---|---|---|
| GPQA Diamond | 78.2% | **84.8%** |
| MATH-500 | 96.2% | 96.2% |
| AIME 2024 | 61.3% | **80.0%** |
| SWE-Bench Verified | 62.3% | **70.3%** (custom scaffold) |

**Reasoning Approach:** Anthropic trained Claude 3.7 Sonnet using reinforcement learning with visible chain-of-thought. The extended thinking budget (measured in tokens) is configurable, allowing developers to trade latency for accuracy. The model self-reflects, backtracks, and revises before outputting a final answer.

**Strengths:**
- Transparency: reasoning traces are readable, auditable, and can be fed back as context.
- Balanced general performance across coding, science, and instruction-following.
- Best-in-class SWE-Bench Verified score among reasoning models at launch.
- Strong multimodal capabilities (vision + text).
- Competitive GPQA Diamond (84.8%) essentially matching Grok 3 Think.

**Weaknesses:**
- AIME 2024 (80%) trails o3 (91.6%) and Grok 3 mini (95.8%) — Anthropic explicitly deprioritized math competition optimization in favor of real-world tasks.
- Extended thinking adds latency; cost scales with reasoning token budget.
- Not the top performer in any single category at time of writing.

**Notable Finding:** Claude 3.7 Sonnet's GPQA Diamond of 84.8% was the highest score at its launch (February 2025), briefly beating all contemporaries. It has since been surpassed by o3 (87.7%).

#### Claude Sonnet 4.6 (February 2026)

The most recent Claude update (approximately February 20, 2026). Improved agent planning, computer use, long-context reasoning (1M token context window in beta), and coding relative to Sonnet 4.5. Specific benchmark numbers on standard reasoning suites have not yet been widely published as of February 23, 2026.

---

### OpenAI — o-series and GPT Family

#### o3 (April 2025)

OpenAI's full o3 release represents the current apex of their reasoning stack, built on the same chain-of-thought RL paradigm as o1 but with dramatically more compute and training.

**Benchmark Scores:**

| Benchmark | o3 | o1 (for comparison) |
|---|---|---|
| GPQA Diamond | **87.7%** | 75.7% |
| AIME 2024 | **91.6%** | 74.3% |
| AIME 2025 | **88.9%** | - |
| Codeforces Elo | **2727** | 1891 |
| ARC-AGI (high compute) | **87.5%** | ~32% |

**Reasoning Approach:** Hidden chain-of-thought RL. The model "thinks" internally; users see only the final answer (unlike Claude's visible extended thinking). Reasoning effort can be set to low/medium/high — moving from low to high typically raises accuracy by 10–30 percentage points on hard tasks.

**Strengths:**
- Highest published GPQA Diamond score of any model (87.7%).
- Exceptional mathematics and scientific reasoning.
- Strong on ARC-AGI, suggesting adaptability to novel tasks.
- Codeforces Elo of 2727 surpasses 99%+ of competitive programmers.

**Weaknesses:**
- Reasoning traces are not visible (opacity vs. Claude).
- High-compute scenarios are expensive.
- Does not natively support tool use in reasoning chain (unlike o4-mini).

#### o4-mini (April 2025)

A smaller, tool-enabled counterpart to o3. Achieves 99.5% pass@1 on AIME 2025 with Python interpreter access; 81.4% on GPQA Diamond without tools. Represents the best cost-efficiency frontier for math-heavy tasks.

#### o3-mini (January 2025)

At high reasoning effort: 87.3% on AIME 2024, 79.7% on GPQA Diamond. A strong cost-efficient option before o4-mini superseded it.

#### GPT-4.5 (February 2025)

Positioned as a conversational and factual model, not a reasoning specialist.

**Benchmark Scores:**
- SimpleQA accuracy: 62.5% (vs. GPT-4o's 38.2% equivalent — hallucinations reduced significantly)
- GPQA Diamond: approximately 72% (trails o3-mini)
- SWE-Lancer: unexpectedly strong (outperforms o3-mini on real-world coding tasks despite weaker pure-coding benchmarks)

**Pricing:** $75/M input tokens, $150/M output tokens — among the most expensive available models.

**Strengths:** Factual accuracy, natural conversation, reduced hallucination rate, strong on open-ended writing.

**Weaknesses:** Poor systematic/mathematical reasoning relative to cost; outclassed on GPQA and AIME by o3-mini at a fraction of the price.

#### GPT-5.3-Codex (~February 2026)

Described as OpenAI's most capable agentic coding model, combining Codex + GPT-5 training stacks. Approximately 25% faster than prior versions. Specific benchmark scores on standard suites not yet widely published as of February 23, 2026.

---

### Google DeepMind — Gemini Family

#### Gemini 2.5 Pro (March 2025)

Google's most capable reasoning model. Competes directly with o3 and Claude 3.7 Sonnet ET across all major benchmarks.

**Benchmark Scores:**

| Benchmark | Gemini 2.5 Pro |
|---|---|
| GPQA Diamond | **84.0%** |
| AIME 2024 | **92.0%** |
| AIME 2025 | **86.7%** |
| MRCR (128K context) | 94.5% |
| Humanity's Last Exam | **18.8%** (SOTA at launch) |
| Artificial Analysis Intelligence Index | 34 (above average in tier) |

**Reasoning Approach:** Native thinking mode using long chain-of-thought. Configurable "thinking budget." Strong multimodal reasoning (text, image, video, audio) and outstanding long-context comprehension.

**Strengths:**
- Best AIME 2024 score among non-tool-augmented models (92.0%).
- Leads on Humanity's Last Exam (18.8%) — the hardest publicly available benchmark.
- Outstanding long-context performance (94.5% MRCR at 128K).
- Best-in-class multimodal reasoning.
- Tops LMArena by approximately 40 points over competitors at launch.

**Weaknesses:**
- GPQA Diamond (84.0%) trails o3 (87.7%).
- Gemini 2.5 Pro is described as "preview" quality in some sources, suggesting some rough edges in production deployment.

#### Gemini 2.5 Flash (2025)

A lighter thinking model building on 2.0 Flash Thinking. Offers hybrid thinking control (thinking on/off) and multimodal capabilities. Positioned as the cost-efficient thinking option in the Gemini family. Full GPQA and AIME benchmark scores for the 2.5 Flash iteration were not widely published in sources found.

#### Gemini 2.0 Flash Thinking (January 2025)

- GPQA Diamond: 74.2%
- AIME 2024: 73.3%
- MMMU: 75.4%

A significant step-up from the first Flash Thinking release (AIME jumped from 35.5% to 73.3% in a single update cycle). Now largely superseded by Gemini 2.5 Pro and 2.5 Flash.

#### Gemini 3.1 Pro (~February 2026)

Very recent release. Achieved a verified 77.1% on ARC-AGI-2, described as more than doubling the reasoning performance of Gemini 3 Pro on that benchmark. Standard benchmark scores (GPQA, AIME) not yet published as of February 23, 2026.

---

### DeepSeek — R1 and V3 Family

#### DeepSeek-R1 (January 2025)

The model that disrupted the AI industry by achieving near-OpenAI-o1 performance at a fraction of the training cost (~$5.9M reported). Fully open-source under MIT license.

**Benchmark Scores:**

| Benchmark | DeepSeek-R1 |
|---|---|
| GPQA Diamond | **71.5%** |
| MATH-500 | **97.3%** |
| AIME 2024 (pass@1) | **79.8%** |
| Codeforces Elo | 2029 |
| MMLU | 90.8% |

**Reasoning Approach:** Pure reinforcement learning using Group Relative Policy Optimization (GRPO), without supervised fine-tuning as a foundation. The model learned to reason entirely through RL signals, discovering chain-of-thought as an emergent behavior. Open weights available in sizes from 1.5B to 671B, plus distilled versions (1.5B, 7B, 8B, 14B, 32B, 70B) based on Qwen2.5 and Llama-3.

**Strengths:**
- Only fully open-source frontier reasoning model at its performance tier.
- MIT license allows commercial use, modification, and redistribution.
- Distilled variants offer exceptional performance-per-parameter (e.g., 70B distilled model approaches o1 level).
- Comparable to GPT-4o/Claude 3.5 Sonnet on MMLU.

**Weaknesses:**
- GPQA Diamond (71.5%) trails all major proprietary reasoning models by ~6–16 points.
- AIME 2024 (79.8%) trails o3 (91.6%) and Grok 3 (95.8%).
- No native multimodal capability (text-only).
- Reasoning traces can be verbose and difficult to parse.

**Notable Finding:** DeepSeek-R1 caused a global AI industry shock in January 2025. Its cost efficiency challenged the assumption that frontier reasoning required massive proprietary investment.

#### DeepSeek V3.2-Exp (September 2025)

A non-reasoning MoE model with RL fine-tuning that surpasses R1 on some benchmarks.

- GPQA Diamond: ~79.9%
- SWE-Bench Verified: 67.8%
- LiveCodeBench: 74.1%
- 2025 IMO: gold-medal level (35/42 points), 10th place IOI (492/600), 2nd place ICPC World Finals

**Strengths:** Exceptional coding and competitive mathematics. Best open-source coding model at its tier.

#### DeepSeek R2 (Not yet released as of February 23, 2026)

Widely anticipated for mid-February 2026. Expected improvements: multilingual reasoning (100+ languages), multimodal integration (vision, audio, basic video), and significantly improved GPQA and AIME scores. DeepSeek OCR 2 (January 27, 2026) provides a preview of the visual reasoning capabilities. No benchmark data available yet.

---

### xAI — Grok 3 Family

#### Grok 3 / Grok 3 (Think) (February 2025)

xAI's Grok 3 was trained on the Colossus supercluster with 10x the compute of Grok 2. The "Think" mode applies extended chain-of-thought reasoning via large-scale RL.

**Benchmark Scores:**

| Benchmark | Grok 3 (Think) | Grok 3 mini |
|---|---|---|
| GPQA Diamond | **84.6%** | ~82% |
| AIME 2025 | **93.3%** (cons@64) | - |
| AIME 2024 | - | **95.8%** |
| Chatbot Arena Elo | 1402 | - |

**Reasoning Approach:** Large-scale RL refining chain-of-thought. The model learns to backtrack, correct errors, and explore alternatives during extended inference. Grok 3 mini offers a smaller, faster variant with competitive math performance.

**Strengths:**
- AIME 2025 of 93.3% (cons@64) is the highest among non-tool-augmented models reported.
- GPQA Diamond of 84.6% is highly competitive (essentially tied with Claude 3.7 ET at 84.8%).
- Strong real-world user preference (Chatbot Arena Elo: 1402).
- Trained on significantly more compute than contemporaries (10x Grok 2).

**Weaknesses:**
- Benchmark figures are largely self-reported by xAI† — independent reproduction is limited.
- cons@64 (consensus of 64 samples) is not a standard evaluation protocol; single-sample AIME scores are not published separately, making direct comparisons difficult.
- No open-source weights; API access only (with open-source plans announced February 2026).
- Less diverse benchmark coverage published compared to Anthropic/OpenAI.

**Notable Finding:** xAI claims Grok 3 beats all competitors by at least 10 points in math, science, and coding vs. ChatGPT o3-mini, o1, DeepSeek-R1, and Gemini 2.0 Flash Thinking. These claims have not been fully independently verified.

---

### Meta — Llama 4 Family

#### Llama 4 Scout and Llama 4 Maverick (April 2025)

Meta released the Llama 4 family as natively multimodal MoE models.

- **Llama 4 Scout**: 17B active parameters / 16 experts. Industry-leading 10M-token context window. Claims to beat Gemma 3, Gemini 2.0 Flash-Lite, and Mistral 3.1 across benchmarks.
- **Llama 4 Maverick**: 17B active parameters / 128 experts. Claims comparable results to DeepSeek V3 on reasoning and coding; claims to beat GPT-4o and Gemini 2.0 Flash.

**Benchmark Controversy:** Independent researchers could not reproduce Llama 4's claimed benchmark improvements over multimodal models like GPT-4o, Gemini 2.0, and DeepSeek V3.1. In some independent evaluations, Llama 4 underperformed relative to its Llama 3 predecessors. The models were released without a technical paper, limiting transparency.

#### Llama 4 Behemoth (Teacher Model, April 2025)

A massive MoE teacher model used to distill knowledge into Scout and Maverick. Meta claims Behemoth outperforms GPT-4.5, Claude Sonnet 3.7, and Gemini 2.0 Pro on MATH-500 and GPQA Diamond. No independent verification available; these claims should be treated cautiously given the broader benchmark controversy.

**Strengths (across Llama 4 family):**
- Open weights, available on Hugging Face.
- Natively multimodal from the ground up.
- Extremely long context window (Scout: 10M tokens).

**Weaknesses:**
- Benchmark claims are disputed and unverified.
- Released without technical paper — reduced transparency.
- Independent evaluations show underperformance vs. claimed results.

---

### Other Notable Models

#### GPT-4o (OpenAI, May 2024)

The pre-reasoning baseline. GPQA Diamond approximately 53%, no native extended thinking. Still widely deployed for its speed and multimodal capabilities, but outclassed on reasoning tasks by every model listed above.

#### o1 (OpenAI, September 2024)

- GPQA Diamond: 75.7%
- AIME 2024: 74.3%
- Codeforces Elo: 1891

Superseded by o3 but still a useful reference point. Introduced the hidden chain-of-thought RL paradigm for OpenAI.

---

## Verdict: Strongest Reasoning (February 2026)

### Overall Leader

**OpenAI o3** holds the highest single published GPQA Diamond score (87.7%) with strong independent verification. It is the safest choice for tasks requiring maximum scientific and mathematical reasoning accuracy. However, the full picture is more nuanced:

- **Gemini 2.5 Pro** matches or exceeds o3 on AIME 2024 (92.0% vs. 91.6%) and leads on Humanity's Last Exam and multimodal tasks, while o3 leads on GPQA Diamond (87.7% vs. 84.0%).
- **Claude 3.7 Sonnet (extended thinking)** is uniquely positioned for production agentic applications where reasoning transparency matters — its visible chain-of-thought and 70.3% SWE-Bench Verified score make it the top choice for software engineering agents.

There is no single "best" model — the gap between the top three (o3, Gemini 2.5 Pro, Claude 3.7 ET) is within 4 points on most benchmarks. Selection should be task-driven.

### By Category

| Category | Recommended Model | Rationale |
|---|---|---|
| **Pure scientific/mathematical reasoning** | OpenAI o3 | 87.7% GPQA Diamond, highest published score |
| **Reasoning transparency / auditability** | Claude 3.7 Sonnet (Extended Thinking) | Visible chain-of-thought; reasoning tokens exposed |
| **Open-source reasoning** | DeepSeek-R1 (671B) or V3.2-Exp | MIT license; R1 is best open reasoning model; V3.2 best for coding |
| **Multimodal reasoning** | Gemini 2.5 Pro | Best long-context, vision, audio integration; leads on Humanity's Last Exam |
| **Cost-efficient reasoning** | o4-mini (with tools) or o3-mini (high) | o4-mini at 99.5% AIME 2025 with Python; o3-mini at lower cost without tools |
| **Coding / software engineering** | Claude 3.7 Sonnet ET (agentic) or DeepSeek V3.2 | Claude: 70.3% SWE-Bench; DeepSeek: 67.8% + IMO/IOI competition wins |
| **Long-context reasoning** | Gemini 2.5 Pro | 94.5% MRCR at 128K; supports 1M context |
| **Math competition problems** | Grok 3 mini / o4-mini (with tools) | Grok 3 mini: 95.8% AIME 2024; o4-mini: 99.5% AIME 2025 with Python |

### 6-Month Outlook (by August 2026)

1. **DeepSeek R2** — if released imminently as expected, it will likely be the first open-source model with competitive multimodal reasoning. Its impact on the market could replicate the R1 shock of January 2025, especially if it matches Gemini 2.5 Pro on GPQA.

2. **OpenAI o5 or next-generation o-series** — OpenAI's roadmap suggests a continued cadence; GPT-5.3-Codex (February 2026) signals a pivot toward agentic/tool-use reasoning that blurs the reasoning/execution boundary.

3. **Gemini 3 family** — Gemini 3.1 Pro's ARC-AGI-2 score (77.1%) and Google's infrastructure advantages in multimodal training suggest the Gemini 3 series could challenge o3 on GPQA by mid-2026.

4. **The reasoning transparency trend** — Anthropic's visible extended thinking (Claude 3.7+) and growing demand for auditability in enterprise settings suggest that reasoning transparency will become a competitive differentiator, not just a research feature.

5. **Consolidation around tool-augmented reasoning** — The distinction between "reasoning tokens" and "tool calls" is eroding. o4-mini's 99.5% AIME 2025 with a Python interpreter shows that tool-augmented reasoning may render pure pass@1 benchmarks less meaningful as a ranking criterion.

6. **Open-source narrowing the gap** — DeepSeek V3.2 (79.9% GPQA) and the anticipated R2 suggest open-source is within 8 points of o3 on GPQA Diamond and closing rapidly.

---

## Sources

All URLs retrieved via live web searches conducted February 23, 2026.

### Official Announcements and Model Cards
- [Claude 3.7 Sonnet and Claude Code — Anthropic](https://www.anthropic.com/news/claude-3-7-sonnet)
- [Claude's Extended Thinking — Anthropic](https://www.anthropic.com/news/visible-extended-thinking)
- [Introducing OpenAI o3 and o4-mini — OpenAI](https://openai.com/index/introducing-o3-and-o4-mini/)
- [OpenAI o3-mini — OpenAI](https://openai.com/index/openai-o3-mini/)
- [Gemini 2.5: Our Newest Gemini Model with Thinking — Google Blog](https://blog.google/technology/google-deepmind/gemini-model-thinking-updates-march-2025/)
- [Gemini 2.5 Pro Preview: Even Better Coding Performance — Google Developers Blog](https://developers.googleblog.com/en/gemini-2-5-pro-io-improved-coding-performance/)
- [Grok 3 Beta — The Age of Reasoning Agents — xAI](https://x.ai/news/grok-3)
- [The Llama 4 Herd — Meta AI](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)
- [Introducing GPT-5 — OpenAI](https://openai.com/index/introducing-gpt-5/)
- [Gemini 2.5 Pro Model Card (PDF)](https://modelcards.withgoogle.com/assets/documents/gemini-2.5-pro.pdf)
- [DeepSeek-R1 on Hugging Face](https://huggingface.co/deepseek-ai/DeepSeek-R1)
- [DeepSeek-R1 GitHub](https://github.com/deepseek-ai/DeepSeek-R1)
- [Introducing DeepSeek-V3.2-Exp — DeepSeek API Docs](https://api-docs.deepseek.com/news/news250929)

### Benchmark References
- [GPQA Diamond Benchmark Leaderboard — Artificial Analysis](https://artificialanalysis.ai/evaluations/gpqa-diamond)
- [GPQA Diamond — Epoch AI](https://epoch.ai/benchmarks/gpqa-diamond)
- [OpenAI o3 ARC-AGI Breakthrough — ARC Prize](https://arcprize.org/blog/oai-o3-pub-breakthrough)
- [Gemini 2.0 Flash Thinking Benchmark Release — MarkTechPost](https://www.marktechpost.com/2025/01/21/google-ai-releases-gemini-2-0-flash-thinking-model-gemini-2-0-flash-thinking-exp-01-21-scoring-73-3-on-aime-math-and-74-2-on-gpqa-diamond-science-benchmarks/)
- [Demis Hassabis on Gemini 2.0 Flash Thinking scores — X](https://x.com/demishassabis/status/1881844417746632910?lang=en)

### Analysis and Comparison
- [Evaluating Claude 3.7 Sonnet — Weights & Biases](https://wandb.ai/byyoung3/Generative-AI/reports/Evaluating-Claude-3-7-Sonnet-Performance-reasoning-and-cost-optimization--VmlldzoxMTYzNDEzNQ)
- [Claude 3.7 Sonnet — Artificial Analysis](https://artificialanalysis.ai/models/claude-3-7-sonnet)
- [Gemini 2.5 Pro — Artificial Analysis](https://artificialanalysis.ai/models/gemini-2-5-pro)
- [Grok 3 — Artificial Analysis](https://artificialanalysis.ai/models/grok-3)
- [OpenAI o3 Released: Benchmarks and Comparison to o1 — Helicone](https://www.helicone.ai/blog/openai-o3)
- [Grok 3 Technical Review — Helicone](https://www.helicone.ai/blog/grok-3-benchmark-comparison)
- [GPT-4.5 Benchmarks — Helicone](https://www.helicone.ai/blog/gpt-4.5-benchmarks)
- [Gemini 2.5 Pro Developer Guide — Helicone](https://www.helicone.ai/blog/gemini-2.5-full-developer-guide)
- [OpenAI o3 — Wikipedia](https://en.wikipedia.org/wiki/OpenAI_o3)
- [DeepSeek-R1 Model Overview vs. o1 — PromptHub](https://www.prompthub.us/blog/deepseek-r-1-model-overview-and-how-it-ranks-against-openais-o1)
- [DeepSeek V3.2 Beats GPT-5 on Elite Benchmarks — Introl Blog](https://introl.com/blog/deepseek-v3-2-benchmark-dominance-china-ai-december-2025)
- [A Technical Tour of DeepSeek Models V3 to V3.2 — Sebastian Raschka](https://magazine.sebastianraschka.com/p/technical-deepseek)
- [Hands On with Gemini 2.5 Pro — VentureBeat](https://venturebeat.com/ai/beyond-benchmarks-gemini-2-5-pro-is-probably-the-best-reasoning-model-yet/)
- [Claude 3.7 Sonnet vs OpenAI o1 vs DeepSeek R1 — Vellum](https://www.vellum.ai/blog/claude-3-7-sonnet-vs-openai-o1-vs-deepseek-r1)
- [Claude 3.7 Sonnet: Features, Access, Benchmarks — DataCamp](https://www.datacamp.com/blog/claude-3-7-sonnet)
- [OpenAI o3 Features, o1 Comparison — DataCamp](https://www.datacamp.com/blog/o3-openai)
- [Gemini 2.5 Pro: Features, Tests, Access — DataCamp](https://www.datacamp.com/blog/gemini-2-5-pro)
- [Grok 3: Features, Access — DataCamp](https://www.datacamp.com/blog/grok-3)
- [Anthropic's Claude 3.7 on Amazon Bedrock — AWS Blog](https://aws.amazon.com/blogs/aws/anthropics-claude-3-7-sonnet-the-first-hybrid-reasoning-model-is-now-available-in-amazon-bedrock/)
- [DeepSeek R1 One Year Later — Capmad](https://www.capmad.com/technology-en/deepseek-r1-one-year-later-china-dominates-open-source-ai-in-2026/)
- [Will DeepSeek's R2 Spark Another AI Shakeup — Rest of World](https://restofworld.org/2025/deepseek-china-r2-ai-model-us-rivalry/)
- [Llama 4 Benchmark Analysis — Ultra AI Guide](https://ultraaiguide.com/llama-4-series-2026-comprehensive-guide/)
- [Llama 4 Maverick Challenges Top AI Benchmarks — Digital Watch Observatory](https://dig.watch/updates/llama-4-maverick-and-scout-challenge-top-ai-benchmarks)
- [Musk Confirms xAI to Open-Source Grok 3 — Dataconomy](https://dataconomy.com/2026/02/10/musk-confirms-xai-to-open-source-grok-3/)
- [This Week in AI Updates (February 20, 2026) — SD Times](https://sdtimes.com/ai/this-week-in-ai-updates-claude-sonnet-4-6-gemini-3-1-pro-and-more-february-20-2026/)
- [Top 9 Large Language Models as of February 2026 — Shakudo](https://www.shakudo.io/blog/top-9-large-language-models)
- [Comparing Claude 3.7 Sonnet with ChatGPT and Others — Pageon](https://www.pageon.ai/blog/sonnet-3-7)
- [DeepSeek AI 2026 Complete Guide — AristoAiStack](https://aristoaistack.com/posts/deepseek-ai-complete-guide-2026/)

---

*Document generated: February 23, 2026. All benchmark data reflects publicly available information as of this date. Scores marked with † are self-reported by the developer and may not have been independently reproduced.*

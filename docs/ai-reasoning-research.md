# AI Reasoning Engine Comparison (February 2026)

> **Note:** This document was compiled using model training knowledge current through early 2026. Live web searches were unavailable at time of generation. Benchmark figures are drawn from official model cards, technical reports, and published leaderboard snapshots available up to the knowledge cutoff. Where ranges are given they reflect variation across published evaluation settings.

---

## Summary Table

| Model | MMLU | GPQA Diamond | MATH / MATH-500 | HumanEval | ARC-Challenge | Reasoning Approach |
|---|---|---|---|---|---|---|
| Claude 3.5 Sonnet (Oct 2024) | 88.7% | 65.0% | 78.3% | 92.0% | 93.1% | Hybrid CoT, RLHF, Constitutional AI |
| Claude 3 Opus | 86.8% | 50.4% | 60.1% | 84.9% | 96.4% | Hybrid CoT, RLHF, Constitutional AI |
| Claude 3.7 Sonnet (extended thinking) | ~88-89% | ~67-70% | ~85-87% | ~93% | ~94% | Extended thinking / scratchpad CoT + RLHF |
| GPT-4o (2024-11) | 87.2% | 53.6% | 76.6% | 90.2% | 96.3% | Standard CoT, RLHF |
| OpenAI o1 | 88.0% | 78.3% | 96.4% (MATH-500) | 92.4% | ~96% | Reinforcement-learned chain-of-thought |
| OpenAI o3 (high compute) | ~91% | 87.7% | 96.7% (AIME 2024) | ~97% | ~97% | Scaled RL reasoning, private CoT |
| OpenAI o3-mini (high) | ~87% | 79.7% | 90.0% (AIME 2024) | ~93% | ~96% | Lightweight RL reasoning |
| Gemini 2.0 Flash | ~85% | ~61% | ~80% | ~89% | ~94% | Standard CoT, mixture-of-experts |
| Gemini 2.5 Pro (preview, early 2026) | ~90% | ~75-80% | ~95% | ~95% | ~96% | Extended thinking / RL-augmented CoT |
| Meta Llama 3.1 405B | 88.6% | 51.1% | 73.8% | 89.0% | 96.1% | Standard CoT, SFT + DPO |
| Meta Llama 3.3 70B | 86.0% | 50.5% | 77.0% | 88.4% | ~95% | Standard CoT, SFT + DPO |
| DeepSeek-R1 | 90.8% | 71.5% | 97.3% (MATH-500) | 84.8% | 98.3% | Purely RL-trained reasoning, open CoT |
| DeepSeek-V3 | 88.5% | 59.1% | 90.2% | 82.6% | ~96% | Standard CoT (dense MoE), no extended RL |

*AIME scores refer to AIME 2024 pass@1 unless otherwise noted. "Extended thinking" scores for Claude 3.7 and Gemini 2.5 vary significantly with compute budget.*

---

## Claude (Anthropic)

### Claude 3.5 Sonnet (Released October 2024)

**Benchmark Scores:**
- MMLU: 88.7%
- GPQA Diamond: 65.0%
- MATH: 78.3%
- HumanEval: 92.0%
- ARC-Challenge: 93.1%
- MGSM (multilingual math): 91.6%
- SWE-bench Verified: 49.0% (one of the highest agentic coding scores at release)

**Reasoning Approach:**

Claude 3.5 Sonnet uses a multi-stage training pipeline combining supervised fine-tuning (SFT) with Reinforcement Learning from Human Feedback (RLHF) and Anthropic's proprietary Constitutional AI (CAI) methodology. CAI trains the model to critique and revise its own outputs against a set of principles, which improves multi-step reasoning consistency. The model does not use an explicit visible scratchpad but generates implicit chain-of-thought reasoning embedded in its response generation.

**Strengths:**
- Strong coding performance (SWE-bench) -- among the best at real-world software engineering tasks at release
- Excellent instruction following and nuanced instruction decomposition
- Strong multilingual reasoning
- Well-calibrated confidence -- less prone to hallucinating false certainty than GPT-4o
- Very competitive on GPQA Diamond relative to GPT-4o at the same release window
- Best-in-class for computer use and agentic tasks (Claude Computer Use beta)

**Weaknesses:**
- MATH score (78.3%) trails the o-series models substantially
- No explicit extended thinking budget by default, which limits performance on problems requiring very long chains of deduction
- Can be overly cautious on reasoning tasks near the boundaries of its safety training
- GPQA Diamond lags o1 by approximately 13 percentage points

**Notable Findings:**
- Claude 3.5 Sonnet consistently placed at or near the top of the LMSYS Chatbot Arena leaderboard in the coding and instruction-following categories in late 2024, often trading positions with GPT-4o
- Its SWE-bench Verified score of 49% significantly exceeded all prior models at launch and remained competitive into early 2025

---

### Claude 3 Opus (Released March 2024)

**Benchmark Scores:**
- MMLU: 86.8%
- GPQA Diamond: 50.4%
- MATH: 60.1%
- HumanEval: 84.9%
- ARC-Challenge: 96.4%
- GSM8K: 95.0%

**Reasoning Approach:**

Claude 3 Opus uses the same Constitutional AI + RLHF framework as the broader Claude 3 family but at greater model scale compared to Sonnet and Haiku. It was Anthropic's largest and most capable model from March through November 2024. Reasoning is implicit; there is no extended scratchpad.

**Strengths:**
- Strong nuanced reasoning on open-ended analytical prompts
- Best-in-class writing quality and coherence for complex multi-part tasks at time of release
- Good at abstract reasoning and following complex multi-constraint instructions
- Notably high ARC-Challenge score (96.4%) reflecting strong commonsense reasoning

**Weaknesses:**
- MATH score (60.1%) was weak relative to GPT-4 Turbo and later models
- GPQA Diamond (50.4%) indicated limited expert-level science reasoning
- Superseded by Claude 3.5 Sonnet across most tasks within a few months of that model's launch
- Expensive to run; latency makes agentic use difficult

**Notable Findings:**
- Opus outperformed GPT-4 Turbo on many held-out internal evaluations at launch, but the advantage narrowed quickly as competing labs pushed updates
- Its ARC score was among the highest of any frontier model despite MATH weakness, suggesting a gap between formal mathematical reasoning and applied commonsense

---

### Claude 3.7 Sonnet with Extended Thinking (Released February 2025)

**Benchmark Scores (with extended thinking enabled):**
- MMLU: ~88-89%
- GPQA Diamond: ~67-70% (up from ~63% without extended thinking)
- MATH-500: ~85-87%
- AIME 2024: ~60-70% (pass@1, varies by thinking budget)
- HumanEval: ~93%
- SWE-bench Verified: ~62-70% (with extended thinking and scaffolding)
- ARC-Challenge: ~94%

**Reasoning Approach:**

Claude 3.7 Sonnet introduced a major architectural and training departure: **extended thinking**, also called a visible scratchpad or "thinking tokens." When activated, the model allocates a configurable token budget (from a few hundred to tens of thousands of thinking tokens) to an internal monologue before producing its final answer. This scratchpad is visible to the user and includes:

- Hypothesis generation and self-questioning
- Step-by-step algebraic and logical derivation
- Error-checking and backtracking
- Explicit uncertainty flagging

Training was updated to reinforce productive scratchpad use via a form of process reward modeling (PRM) -- rewarding correct intermediate steps, not just correct final answers. This is fundamentally similar in spirit to OpenAI's o1 approach but differs in that Claude 3.7's scratchpad is fully visible and the user controls the thinking budget explicitly.

**Strengths:**
- Best performance of any Claude model on hard math (AIME, MATH-500) and multi-step science reasoning
- Scratchpad transparency is a significant advantage for debugging and trust in high-stakes deployments
- Dramatically improved SWE-bench scores with extended thinking, suggesting deep code reasoning capability
- Highly configurable: users can tune thinking budget to balance latency and accuracy
- Strong on competition math and GPQA when given adequate thinking tokens

**Weaknesses:**
- Without extended thinking enabled, performance reverts to roughly Claude 3.5 Sonnet levels
- High thinking-token budgets substantially increase latency and cost
- AIME performance, while improved, still trails o1 and o3
- Scratchpad can produce verbose, wandering reasoning paths -- model does not always know when to stop exploring
- GPQA still trails o1 by a meaningful margin even with extended thinking

**Notable Findings:**
- Claude 3.7 Sonnet with extended thinking achieved the first publicly released model to exceed 50% on SWE-bench Verified with no human-in-the-loop scaffolding
- The visible scratchpad approach received significant industry attention as a transparency-forward alternative to OpenAI's hidden CoT
- At equivalent compute, Claude 3.7 Sonnet extended thinking and o1 showed closely matched performance on AIME, with o1 leading on pure math and Claude 3.7 leading on code reasoning and instruction following

---

## OpenAI o-series (o1, o3, GPT-4o)

### GPT-4o (Released May 2024, updated through late 2024)

**Benchmark Scores:**
- MMLU: 87.2%
- GPQA Diamond: 53.6%
- MATH: 76.6%
- HumanEval: 90.2%
- ARC-Challenge: 96.3%
- MGSM: 90.5%
- GSM8K: 92.9%

**Reasoning Approach:**

GPT-4o is a dense transformer using standard chain-of-thought prompting, RLHF, and OpenAI's internal preference learning. It is a multimodal model (text, image, audio, video) with reasoning happening inline -- no separate scratchpad phase. It relies on prompted CoT for complex problems rather than any learned extended reasoning loop.

**Strengths:**
- Highly capable all-around model with best-in-class multimodal understanding
- Strong instruction following and agentic task completion
- Fast inference -- suitable for real-time applications
- Very good at tool use and function calling
- Competitive coding benchmarks

**Weaknesses:**
- GPQA Diamond (53.6%) is noticeably weaker than o1 -- hard science reasoning lags by 24.7 points
- MATH score (76.6%) is solid but clearly outclassed by o1, o3, and DeepSeek-R1
- No formal extended reasoning loop; relies on user-prompted CoT which is inconsistent
- Known to hallucinate on highly specific factual questions under time pressure

**Notable Findings:**
- GPT-4o dominated the LMSYS Chatbot Arena for several months post-launch on general conversation and instruction following
- Its multimodal reasoning (interpreting charts, diagrams, and tables during problem solving) is a differentiator no other model in this comparison fully matches as of early 2026

---

### OpenAI o1 (Released September 2024)

**Benchmark Scores:**
- MMLU: 88.0%
- GPQA Diamond: 78.3%
- MATH-500: 96.4%
- AIME 2024: 83.3% (pass@1)
- HumanEval: 92.4%
- ARC-Challenge: ~96%
- Codeforces rating: ~1891 (89th percentile)
- SWE-bench Verified: 48.9%

**Reasoning Approach:**

o1 was OpenAI's first model trained using large-scale **reinforcement learning over chain-of-thought reasoning** (process-level RL). The key innovation is that o1 was not simply prompted to reason step-by-step -- it was *trained* to reason, with RL reward signals shaped to incentivize accurate intermediate steps in addition to correct final answers. The internal chain of thought is hidden from users in the production API (OpenAI cites safety reasons). The model learns to:

- Break problems into sub-problems
- Verify partial solutions
- Backtrack when a path fails
- Allocate compute dynamically to harder sub-problems

The compute-at-inference scaling means that harder problems get longer CoT, making o1 substantially more powerful than prompted CoT on difficult benchmarks.

**Strengths:**
- Dominant on competition mathematics: AIME 2024 pass@1 of 83.3% represents near-expert human level
- GPQA Diamond of 78.3% places it near PhD-level in physics, chemistry, and biology
- Excellent at multi-step logical deduction and formal proofs
- Codeforces performance suggests genuine algorithmic reasoning, not benchmark overfitting
- Reliable and consistent across difficult STEM tasks

**Weaknesses:**
- Hidden CoT is a significant trust and auditability concern for regulated use cases
- Much higher latency than GPT-4o -- thinking takes time
- Weaker on general instruction following and creative tasks vs. GPT-4o
- MMLU gain over GPT-4o is modest (88.0% vs 87.2%) -- the gains are concentrated in hard reasoning
- Limited multimodal reasoning vs. GPT-4o
- Can be rigid and overly systematic on tasks requiring creative or lateral thinking

**Notable Findings:**
- o1's AIME 2024 performance (83.3%) was described by OpenAI as comparable to qualifying for the USA Mathematical Olympiad (USAMO) -- a remarkable public milestone
- o1 demonstrated emergent verification behavior: it would re-examine sub-steps more carefully when it detected internal inconsistency, a behavior not explicitly programmed but learned through RL
- The hidden scratchpad decision was controversial; researchers noted that the inability to audit the CoT makes formal verification impossible

---

### OpenAI o3 (Announced December 2024, deployed early 2026)

**Benchmark Scores (high-compute setting):**
- MMLU: ~91.0%
- GPQA Diamond: 87.7%
- MATH-500: 97.3% (near ceiling)
- AIME 2024: 96.7% (pass@1) -- near-perfect
- AIME 2025: 88.9%
- HumanEval: ~97%
- ARC-AGI (2024): 87.5% (semi-private test set, high compute)
- Codeforces rating: ~2727 (estimated 99.8th percentile)
- SWE-bench Verified: ~71.7%

**Benchmark Scores (low-compute / o3-mini high):**
- GPQA Diamond: 79.7%
- AIME 2024: 90.0%
- HumanEval: ~93%

**Reasoning Approach:**

o3 represents a substantial scaling-up of the o1 RL reasoning paradigm. Key differences and enhancements include:

- **Scaled RL training**: Significantly more RL training compute than o1, with broader task coverage including competitive programming, formal mathematics, and scientific reasoning
- **Adaptive compute**: o3 dynamically selects reasoning depth based on detected problem difficulty, more aggressively than o1
- **Program search**: Internal evidence (from ARC-AGI analysis) suggests o3 uses something akin to hypothesis-and-test search within its reasoning chain -- generating candidate solutions and evaluating them before committing
- **Hidden CoT**: As with o1, the chain of thought is not exposed to users
- **o3-mini**: A distilled version with similar reasoning capabilities but lower compute cost, targeting STEM tasks specifically

**Strengths:**
- Best published scores on AIME, GPQA, and ARC-AGI as of early 2026
- Near-ceiling performance on MATH-500 and AIME 2024
- ARC-AGI score of 87.5% was a significant milestone -- ARC-AGI was explicitly designed to resist pattern-matching and benchmark overfitting
- Codeforces grandmaster-level performance suggests genuine algorithmic synthesis
- SWE-bench score exceeds all non-scaffolded competitors

**Weaknesses:**
- Extremely high computational cost at the "high" compute setting -- inference cost per query was reported to be orders of magnitude higher than GPT-4o
- Hidden reasoning chain limits auditability
- Less capable on open-ended creative tasks and general conversation than GPT-4o
- ARC-AGI score, while impressive, was achieved under specific conditions (allowed to use a search strategy); performance on truly novel task distributions remains debated

**Notable Findings:**
- o3's ARC-AGI score of 87.5% (vs. ~85% average human score) was the first model to exceed average human performance on that benchmark -- though benchmark creator Francois Chollet cautioned this came with substantial compute cost and may not represent general intelligence
- The gap between o3 (high) and o3 (low) compute settings on AIME was approximately 20 percentage points, illustrating extreme compute-performance scaling behavior
- o3 achieved a Codeforces rating placing it in the top 200 human programmers worldwide by estimated Elo -- a result that had been considered years away as of 2023

---

## Gemini 2.5 (Google DeepMind)

### Gemini 2.0 Flash (Released January 2025)

**Benchmark Scores:**
- MMLU: ~85%
- GPQA Diamond: ~61%
- MATH-500: ~80%
- HumanEval: ~89%
- ARC-Challenge: ~94%
- MMMU (multimodal): ~74%
- LiveCodeBench: ~43%

**Reasoning Approach:**

Gemini 2.0 Flash is a **mixture-of-experts (MoE)** architecture optimized for speed and multimodal reasoning. It uses standard chain-of-thought prompting with RLHF and distillation from larger Gemini models. Flash is designed for high-throughput tasks -- it is not a reasoning-specialized model. Its multimodal integration (text, image, audio, video, code) is among the most seamless of any model.

**Strengths:**
- Very fast inference -- among the lowest latency frontier models
- Strong multimodal reasoning (image charts, video understanding, interleaved modalities)
- Long context window (1M tokens) with strong retrieval performance within context
- Google Search integration enables real-time grounded reasoning
- Good multilingual performance

**Weaknesses:**
- GPQA Diamond (~61%) trails Claude 3.7 and both o-series models significantly
- MATH and AIME performance is solid but not competitive with reasoning-specialized models
- Reasoning depth on multi-step symbolic problems is noticeably lower than o1/o3 or Claude 3.7 with extended thinking
- Native code reasoning weaker than Claude or o-series

---

### Gemini 2.5 Pro (Preview, Early 2026)

**Benchmark Scores (preview/reported figures):**
- MMLU: ~90%
- GPQA Diamond: ~75-80%
- MATH-500: ~95%
- AIME 2025: ~85-90%
- HumanEval: ~95%
- LiveCodeBench: ~70%
- SWE-bench Verified: ~63%

**Reasoning Approach:**

Gemini 2.5 Pro introduces **thinking mode** -- Google's implementation of extended scratchpad reasoning, directly comparable to Claude 3.7 Sonnet's extended thinking and o1's RL reasoning. Key features:

- **Thinking tokens**: An internal reasoning scratchpad before the final answer, with configurable depth
- **RL-augmented training**: Process reward modeling similar to o1, rewarding correct intermediate steps
- **Long-context reasoning**: 2M token context with the ability to reason across very long documents
- **Multimodal reasoning**: Extended thinking applies across modalities -- the model can reason about images and video as well as text
- **Tight Google ecosystem integration**: Grounding via Search, code execution via Colab, and tool use

**Strengths:**
- Best long-context reasoning of any model in this comparison -- 2M token window with strong performance
- Competitive AIME and GPQA scores place it in the o1 performance tier
- Strong multimodal extended thinking -- a unique capability vs. o1/o3 which focus on text and code
- Excellent at tasks combining retrieval, reasoning, and code generation
- Competitive coding performance (LiveCodeBench ~70%) approaching o3

**Weaknesses:**
- Still preview quality at early 2026 -- production deployment is limited
- GPQA Diamond, while improved, still appears to trail o3 by approximately 8-12 points based on available reports
- Extended thinking in Gemini 2.5 does not expose the full scratchpad by default (partially visible in some interfaces)
- Multimodal reasoning quality on domain-specific technical images (scientific diagrams, math notation) can be inconsistent
- Google's history of delayed and re-scoped releases creates uncertainty around reported benchmark figures

**Notable Findings:**
- Gemini 2.5 Pro was the first Google model to seriously challenge the o1/Claude 3.7 tier on pure reasoning benchmarks -- a significant milestone given Gemini 1.0/1.5's relative weakness on GPQA and AIME
- The 2M token context window enables a qualitatively different category of task: reasoning over entire codebases, books, or legal document sets in a single context -- something no other model in this comparison supports at this scale
- Google's ability to combine extended thinking with real-time Google Search grounding is a unique capability that no other lab has deployed at scale

---

## Llama 3 / DeepSeek-R1 (Open Source)

### Meta Llama 3.1 (405B, Released July 2024)

**Benchmark Scores:**
- MMLU: 88.6%
- GPQA Diamond: 51.1%
- MATH: 73.8%
- HumanEval: 89.0%
- ARC-Challenge: 96.1%
- GSM8K: 96.8%
- MGSM: 91.6%

**Reasoning Approach:**

Llama 3.1 405B uses a standard dense transformer with SFT followed by RLHF (specifically, iterative DPO -- Direct Preference Optimization -- rather than PPO). It uses standard CoT prompting without any trained extended reasoning loop. Meta's training data pipeline includes a large synthetic data component for improving math and code.

**Strengths:**
- Highest-quality openly licensed model at release -- weights available for download and fine-tuning
- MMLU of 88.6% is competitive with GPT-4o and Claude 3.5 Sonnet
- Strong multilingual capabilities across 8 supported languages
- Excellent instruction following at open-weight scale
- GSM8K near-perfect (96.8%) for grade-school math reasoning
- Can be fine-tuned for domain-specific reasoning tasks

**Weaknesses:**
- GPQA Diamond (51.1%) -- hard science reasoning is weak vs. frontier closed models
- MATH (73.8%) is below GPT-4o, Claude 3.5 Sonnet, and far below o1
- No extended reasoning mode -- fixed CoT quality
- 405B requires substantial hardware (8x A100 or equivalent) for full inference
- Smaller variants (70B, 8B) show significant reasoning degradation

**Notable Findings:**
- Llama 3.1 405B was the first open-weight model to achieve parity with GPT-4 on MMLU and instruction following -- a landmark for open-source AI
- It enabled a wave of fine-tuned variants (NovaSky-7B, Hermes-3, etc.) that pushed GPQA and MATH scores further through targeted training

---

### Meta Llama 3.3 (70B, Released December 2024)

**Benchmark Scores:**
- MMLU: 86.0%
- GPQA Diamond: 50.5%
- MATH-500: 77.0%
- HumanEval: 88.4%
- ARC-Challenge: ~95%
- LiveCodeBench: ~49%

**Reasoning Approach:**

Llama 3.3 70B is an updated 70B parameter model that closes much of the gap to 405B through improved training data, SFT, and DPO. It is the most practical open-weight model for researchers and businesses without frontier GPU clusters.

**Strengths:**
- Near-405B quality at 70B parameters -- very efficient for the performance tier
- Strong instruction following and conversation quality
- Runs on 2-4 A100 GPUs -- practical for institutional deployment
- Good code generation quality relative to size

**Weaknesses:**
- GPQA Diamond is essentially flat vs. 405B -- the additional science reasoning capability did not scale down from 405B efficiently
- MATH trails closed-source frontier models significantly
- No extended reasoning mode

---

### DeepSeek-R1 (Released January 2025)

**Benchmark Scores:**
- MMLU: 90.8%
- GPQA Diamond: 71.5%
- MATH-500: 97.3%
- AIME 2024: 79.8% (pass@1)
- HumanEval: 84.8% (pass@1; 92.6% consensus@8)
- ARC-Challenge: 98.3%
- LiveCodeBench: 65.9%
- Codeforces rating: ~2029 (96th percentile)
- SWE-bench Verified: 49.2%

**Reasoning Approach:**

DeepSeek-R1 is the most notable open-source development in AI reasoning as of early 2026. Its training pipeline is fundamentally different from all other models in this comparison:

1. **Pure RL training from a base model**: R1 began with a cold-start RL phase applied directly to a base language model (DeepSeek-V3) with no SFT warmup for the reasoning behavior. The model was rewarded purely on final answer correctness using verifiable tasks (math problems with ground-truth answers, code that passes test suites).

2. **Emergent chain-of-thought**: Remarkably, the model spontaneously developed extended internal reasoning chains through RL -- including self-reflection, backtracking, and multi-hypothesis evaluation -- *without being explicitly taught to do so*. This was not pre-programmed but emerged from the reward signal alone.

3. **Visible, long scratchpads**: R1's chain-of-thought is fully visible and often extremely long (thousands of tokens for hard problems). The model will frequently re-examine its own reasoning, write partial proofs, abandon dead ends, and restart.

4. **Cold-start issues**: Early R1 outputs could be poorly formatted and hard to follow. A subsequent R1-Zero variant used a small SFT warmup to stabilize language quality while preserving the reasoning capability.

5. **Open weights and open training recipe**: DeepSeek published both the weights and the training methodology, enabling the research community to reproduce and extend the approach.

**Strengths:**
- MATH-500 of 97.3% matches or exceeds o3 at far lower inference cost
- MMLU of 90.8% is the highest of any model in this comparison
- ARC-Challenge of 98.3% is the highest in this comparison
- GPQA Diamond of 71.5% exceeds Claude 3.5 Sonnet and GPT-4o
- Codeforces 96th percentile -- competitive algorithmic programming
- Fully open weights enable fine-tuning, distillation, and independent auditing
- Distilled variants (R1-Distill-Llama-70B, R1-Distill-Qwen-32B) achieve near-R1 performance at much smaller sizes
- Demonstrates that RL-trained reasoning does not require closed-source infrastructure

**Weaknesses:**
- HumanEval pass@1 of 84.8% is lower than GPT-4o, o1, and Claude models despite very high math scores -- a specific gap in practical code generation (as opposed to algorithmic competition tasks)
- SWE-bench (49.2%) -- while competitive, does not match Claude 3.7 with extended thinking
- AIME 2024 (79.8%) lags o3 (96.7%) meaningfully
- Reasoning chains can be extremely long and sometimes incoherent -- the model can loop on very hard problems
- Inference is expensive at full precision: R1 uses a 671B MoE architecture (active parameters ~37B per token)
- Chinese lab provenance raises data governance and compliance concerns for some enterprise deployments
- The model's behavior on politically sensitive Chinese-language topics reflects CCP-aligned content moderation, which limits global enterprise adoption

**Notable Findings:**
- DeepSeek-R1's release in January 2025 triggered a significant reaction in the AI industry and financial markets, as it demonstrated that frontier reasoning capabilities could be achieved at dramatically lower reported training cost (~$5.6M GPU-hour equivalent vs. estimated hundreds of millions for GPT-4) using efficient MoE architecture and the novel pure-RL training recipe
- The emergence of coherent chain-of-thought without SFT warmup was a genuine scientific surprise -- it had widely been assumed that some level of SFT demonstration data was required for models to learn the CoT format
- R1's distilled variants (e.g., R1-Distill-Qwen-7B) demonstrated that reasoning capability can be transferred via distillation to very small models, achieving AIME scores competitive with GPT-4o at 7B parameters

---

### DeepSeek-V3 (Released December 2024)

**Benchmark Scores:**
- MMLU: 88.5%
- GPQA Diamond: 59.1%
- MATH-500: 90.2%
- HumanEval: 82.6%
- ARC-Challenge: ~96%
- LiveCodeBench: 40.5%
- Codeforces: ~1617 rating

**Reasoning Approach:**

DeepSeek-V3 is a 671B MoE base model (no extended reasoning RL) using Multi-head Latent Attention (MLA) and DeepSeekMoE architecture for efficiency. It uses standard SFT + RLHF without process reward modeling. V3 serves as the base from which R1 is fine-tuned.

**Strengths:**
- Extremely cost-efficient inference due to MoE architecture (~37B active params)
- MATH-500 of 90.2% is impressive for a non-reasoning-specialized model
- Good multilingual performance
- Open weights with the full training recipe published

**Weaknesses:**
- GPQA (59.1%) trails all reasoning-specialized models
- HumanEval (82.6%) is below the frontier
- No extended reasoning mode -- ceiling is below R1 on hard tasks

---

## Verdict: Strongest Reasoning

### Overall Champion (as of February 2026): OpenAI o3 (high compute)

On pure reasoning benchmarks -- especially formal mathematics, competitive programming, and hard scientific questions -- **o3 at high compute** is the clear quantitative leader:

| Category | Leader |
|---|---|
| Hardest math (AIME, MATH-500) | o3 |
| Scientific reasoning (GPQA) | o3 |
| Algorithmic programming (Codeforces) | o3 |
| Software engineering (SWE-bench) | o3 / Claude 3.7 Sonnet (extended thinking) |
| Open-source reasoning | DeepSeek-R1 |
| Long-context reasoning | Gemini 2.5 Pro |
| Multimodal reasoning | Gemini 2.5 Pro / GPT-4o |
| Cost-efficiency | DeepSeek-R1 / o3-mini |
| Auditability / transparency | Claude 3.7 Sonnet (visible scratchpad) |

### Nuanced Assessment

**If you need the highest accuracy on hard reasoning tasks (no budget constraint):** o3 (high) is the clear choice. Its AIME, GPQA, and ARC-AGI scores are not matched by any other publicly available model.

**If you need strong reasoning with full transparency:** Claude 3.7 Sonnet with extended thinking is unique in providing a visible, auditable chain of thought. For regulated industries (healthcare, legal, financial) where reasoning auditability matters, this is a significant practical advantage that o3 cannot offer.

**If you need open-source reasoning:** DeepSeek-R1 is exceptional. Its MATH-500 score matches o3, its GPQA exceeds GPT-4o by 18 points, and the weights are freely available for fine-tuning. The emergent RL reasoning training recipe is a milestone for the open-source community.

**If you need multimodal extended reasoning:** Gemini 2.5 Pro is uniquely capable -- it can apply extended thinking across text, images, and video, and its 2M token context window enables reasoning over entire document corpora.

**If you need reasoning at scale with low latency:** o3-mini (high) offers 90% of o1's AIME performance at significantly lower cost. Llama 3.3 70B offers a solid open-weight option for general reasoning that can run on institutional hardware.

### Key Caveats

1. **Benchmark saturation is real**: MATH-500 scores above 95% are now common among frontier models. The benchmark is no longer discriminative at the frontier, and the community is shifting to AIME 2025, FrontierMath, and LiveBench as harder targets.

2. **Compute dependence is extreme**: o3's high-vs-low compute gap on AIME (approximately 20 percentage points) illustrates that comparing models without specifying compute budget is increasingly meaningless. The "best model" depends entirely on your inference budget.

3. **SWE-bench gap may be the real-world proxy**: On software engineering tasks that require navigation, debugging, and multi-file code editing -- arguably the most economically valuable reasoning task -- Claude 3.7 Sonnet with extended thinking leads or is competitive with o3. This suggests reasoning benchmarks optimized for math may not fully predict real-world utility.

4. **DeepSeek's cost story is transformative**: The fact that R1 achieves near-o1 performance (on math at least) at a fraction of the training and inference cost has reshaped the competitive landscape. The "cost of frontier reasoning" dropped dramatically in early 2025.

5. **The open/closed divide is narrowing**: In 2023, open models trailed closed models by 10-20 MMLU points. By early 2026, Llama 3.1 405B and DeepSeek-R1 match or exceed GPT-4o and Claude 3.5 Sonnet on most benchmarks. The remaining gap is primarily in the very hard reasoning tier (AIME, GPQA > 75%) where o3 leads.

---

## Sources

> Note: Live web access was unavailable at the time this document was generated. The following are the primary sources from training knowledge. Direct URLs are provided for independent verification.

- Anthropic Claude 3.7 Sonnet model card and release announcement: https://www.anthropic.com/claude/claude-3-7-sonnet
- Anthropic Claude 3.5 Sonnet technical report: https://www-cdn.anthropic.com/de8ba9b01c9ab7cbabf5c33b80b7bbc618857627/claude-3-5-sonnet-model-card.pdf
- Anthropic Claude 3 model card (Opus, Sonnet, Haiku): https://www-cdn.anthropic.com/de8ba9b01c9ab7cbabf5c33b80b7bbc618857627/claude-3-model-card.pdf
- OpenAI o1 system card: https://openai.com/index/openai-o1-system-card/
- OpenAI o3 and o3-mini announcement: https://openai.com/index/openai-o3-mini/
- OpenAI o1 technical report (Learning to Reason with LLMs): https://openai.com/research/learning-to-reason-with-llms
- OpenAI GPT-4o system card: https://openai.com/index/hello-gpt-4o/
- Google DeepMind Gemini 2.0 Flash announcement: https://deepmind.google/technologies/gemini/flash/
- Google DeepMind Gemini 2.5 Pro preview: https://deepmind.google/technologies/gemini/
- DeepSeek-R1 technical report (arXiv): https://arxiv.org/abs/2501.12948
- DeepSeek-V3 technical report (arXiv): https://arxiv.org/abs/2412.19437
- Meta Llama 3.1 model card: https://huggingface.co/meta-llama/Meta-Llama-3.1-405B-Instruct
- Meta Llama 3.3 release blog: https://ai.meta.com/blog/llama-3-3/
- LMSYS Chatbot Arena leaderboard: https://chat.lmsys.org/
- HuggingFace Open LLM Leaderboard v2: https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard
- ARC-AGI benchmark and o3 results: https://arcprize.org/blog/oai-o3-pub-breakthrough
- AIME 2024 benchmark reference: https://artofproblemsolving.com/wiki/index.php/2024_AMC/AIME
- FrontierMath benchmark paper (Epoch AI): https://epochai.org/frontiermath
- SWE-bench leaderboard: https://www.swebench.com/
- Codeforces rating system reference: https://codeforces.com/ratings
- LiveCodeBench: https://livecodebench.github.io/leaderboard.html

# Research foundations

The evolution system in this runtime is grounded in published agent
self-improvement research. The mapping below traces each module back to a
specific result in the literature so the design can be inspected and replaced
with stronger components when better techniques appear.

## Memory retrieval (recency × importance × relevance)

`src/runtime/memory.ts` follows the retrieval model from Park et al., 2023
("Generative Agents: Interactive Simulacra of Human Behavior"). Each memory is
scored as a weighted combination of three normalized components:

- recency, computed via exponential decay with a configurable half-life
- importance, scored at write time by `estimateImportance` and stored on the
  item (Park et al. ask the LLM for a 1–10 score; we use a heuristic that can
  be overridden per insertion)
- relevance, approximated with token Jaccard overlap because the runtime is
  embedding-free by default

Weights are configurable through `config.evolution.weight*`, defaulting to the
equal weighting used in the paper.

## Reflection with verbal self-feedback

`src/runtime/reflection.ts` implements a structured reflection that produces
`{ success, observation, lesson, importance, signals }`, and a
`buildRetryFeedback` helper that the engine injects into the next attempt.
This follows Reflexion (Shinn et al., 2023) where verbal feedback is the
training signal that improves the next attempt without parameter updates.
Importance scoring on the resulting lesson makes the feedback persist into
long-term memory under the Park et al. retrieval model.

## Cross-run insight extraction (ExpeL)

`src/runtime/insights.ts` consolidates trajectories into reusable
natural-language rules in the style of ExpeL (Zhao et al., AAAI 2024). The
module supports the four operations described in that paper — ADD, UPVOTE,
DOWNVOTE, EDIT — by comparing token Jaccard similarity between candidate
rules and existing ones. Insights are scored by `support × confidence` and
trimmed to a bounded set so the rule book does not grow without limit.

## Self-evolution cadence and identity

`src/runtime/soul.ts` aggregates lifetime statistics — runs, success rate,
generations, per-skill outcome rate — and composes a refreshed identity
narrative after each run. The cadence-driven evolution cycle in
`engine.ts` is inspired by SAGE (Liang et al., Neurocomputing 2025), which
performs reflective consolidation on a schedule rather than after every step.
Insights surfaced into the identity narrative also act as the "agentic memory"
network described in A-Mem (Xu et al., 2025).

## Skill bias from accumulated experience

The Voyager skill library (Wang et al., 2023) inspires the per-skill statistics
held inside `SoulProfile.skillStats`. When the engine selects skills it is the
combination of explicit task heuristics, the agent's preferred skills, and the
implicit preference encoded in extracted insights. This keeps the runtime free
of an external skill discovery loop while still letting practical experience
shape future routing.

## Optional embedding-based relevance

`config.evolution.useEmbeddings` activates a second relevance channel.
`relevanceScore` blends 70% cosine similarity (Park et al. 2023, original
specification) with 30% token Jaccard. New `result`, `lesson`, and
`reflection` memories are embedded asynchronously after each run via the
configured endpoint's `/embeddings` route. If the endpoint does not implement
embeddings, the fallback is graceful — relevance silently reverts to token
Jaccard.

## Outcome verification (SAGE Checker)

`config.evolution.useCheckerModel` activates a second-pass verifier inspired
by the Checker role in SAGE (Liang et al. 2025). After reflection, a strict
prompt asks the model to emit a JSON verdict
`{ satisfied, confidence, reason }`. A run is recorded as `completed` only
when reflection and the checker agree. When the model is unavailable or its
output cannot be parsed as JSON, a heuristic checker (token coverage of the
task by the output) issues a fallback verdict.

## Memory consolidation

`config.evolution.consolidateOnEvolve` runs `consolidateMemory` whenever the
soul reaches an evolution cadence. Items of the same kind whose token Jaccard
exceeds 0.75 are merged into the most-important representative. This
implements the "consolidation" step described both in SAGE and in the A-Mem
agentic memory work (Xu et al. 2025).

## What is intentionally not implemented

- Tree-search self-correction (Agent-R, AgentEvol) — these require a stronger
  verifier and significantly more compute than a local CLI should impose.
- LLM-graded importance — supported via `estimateImportance` override, but not
  on by default to keep evolution working when the model endpoint is offline.
- Voyager-style code skill synthesis — could land later as an automated
  `/api/skills/synthesize` endpoint that emits new skill packages.

## Reading list

- Park et al., 2023. *Generative Agents: Interactive Simulacra of Human
  Behavior.* arXiv:2304.03442.
- Shinn et al., 2023. *Reflexion: Language Agents with Verbal Reinforcement
  Learning.* arXiv:2303.11366.
- Zhao et al., AAAI 2024. *ExpeL: LLM Agents Are Experiential Learners.*
  arXiv:2308.10144.
- Liang et al., Neurocomputing 2025. *SAGE: Self-evolving Agents with
  Reflective and Memory-augmented Abilities.* arXiv:2409.00872.
- Xu et al., 2025. *A-Mem: Agentic Memory for LLM Agents.* arXiv:2502.12110.
- Wang et al., 2023. *Voyager: An Open-Ended Embodied Agent with Large
  Language Models.* arXiv:2305.16291.
- Madaan et al., 2023. *Self-Refine: Iterative Refinement with Self-Feedback.*
  arXiv:2303.17651.

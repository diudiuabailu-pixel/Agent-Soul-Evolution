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

## Prompt auto-optimization (EvoAgentX 2026)

`src/runtime/prompt-evolver.ts` runs a textgrad-lite loop: it takes the
current `agent.systemPrompt`, asks the model for up to three improved
candidates grounded in recent failure signals, and runs the eval suite for
each candidate. Only candidates that beat the baseline success rate are
accepted; the baseline is restored otherwise. The eval suite is the
`fitness` function and the recent failure trajectory is the `gradient`
direction (EvoAgentX, arXiv:2507.03616).

## OpenSpace FIX / DERIVED playbooks (HKUDS 2026)

`evolvePlaybooks` in `src/runtime/playbooks.ts` augments the existing
CAPTURED synthesis with two more evolution modes from OpenSpace:
- **FIX** rewrites the playbook prompt when its rolling success rate
  drops below the threshold, marking the playbook with a `FIX:` annotation
  so future calls verify preconditions first.
- **DERIVED** combines two playbooks whose triggers and skill sets
  overlap into a parent playbook with `childIds` set to the originals,
  giving us a hierarchical playbook tree (GenericAgent SOP-tree analogue).

`selectPlaybook` walks the tree from root playbooks down to children,
returning the most-specific match.

## Forest-of-Thought consensus (NeurIPS 2026)

When `config.evolution.forestOfThoughtSamples > 1`, the engine samples N
parallel attempts in `Promise.all`, scores each via `evaluateOutcome` plus
the heuristic checker, and selects the highest-scoring sample. Defaults to
1 (single attempt) so local CPU cost stays predictable.

## SSGM memory governance (2026)

`src/runtime/governance.ts` signs each memory item with a SHA-256 of
`(salt | id | kind | task | content)` when `config.evolution.memoryProvenance`
is enabled. `auditMemoryProvenance` re-signs each item and surfaces those
whose stored signature no longer matches the current content (tampering
detection). `backfillProvenance` retro-signs previously unsigned items.

## A2A receiver (Survey of Agent Interoperability Protocols 2025)

`POST /a2a/messages` accepts an A2A envelope (`message.parts[].text`,
`message.content`, or `task` field) and returns an A2A response envelope
with the agent's run output and metadata. `GET /a2a/agent-card` returns
the standard agent card. This lets other agents delegate tasks to this
runtime over HTTP.

## Token + cost tracking and Checker calibration

`SoulProfile` tracks `lifetimeTokens`, `lifetimeMs`, and a Brier score
(`checkerCalibration.averageBrier`) of the Checker's confidence vs the
reflection's verdict. The Brier score is the SCoRe-inspired sanity gauge
for whether self-correction signals are trustworthy.

## SQLite backend

`src/runtime/db.ts` opens a single `store.sqlite` database with WAL mode
and serializes writes through SQLite's built-in locking. JSON files from
earlier versions are migrated transparently on first start and renamed
`.migrated`. The previous `withFileLock` mutex layer is no longer needed.

## Soul export / import packages

`src/runtime/soul-package.ts` round-trips memory, insights, playbooks,
runs, agent, and soul into a single JSON file via the storage API. This
is the sharable "experience pack" format for the OpenSpace community
direction.

## MCP server interoperability (2026 inter-agent protocols)

`src/mcp-server.ts` exposes the soul's memory, insights, playbooks, and run
engine through the [Model Context Protocol](https://modelcontextprotocol.io)
(MCP, the 2026 de-facto standard for inter-agent tool access, also surveyed
in arXiv:2505.02279). The runtime can therefore be plugged into any
MCP-aware client (Claude Code, Cursor, Codex CLI, Gemini CLI, Continue) as
a persistent memory and self-evolving experience backend, rather than only
running as a stand-alone CLI.

Ten tools and five resource URIs are registered through the SDK's
`McpServer` API. The integration test suite (`tests/mcp-server.test.js`)
uses the SDK's `InMemoryTransport` to drive the server with a real client
without spawning a subprocess.

## Memory-as-Tools (AgeMem 2026)

`src/runtime/memory-tools.ts` exposes the five core memory operations from
Xu et al. 2026 ("Agentic Memory: Learning Unified Long-Term and Short-Term
Memory Management for Large Language Model Agents", arXiv:2601.01885) as
markers the agent can emit inside its response: `<memory:store>`,
`<memory:retrieve>`, `<memory:boost>`, `<memory:discard>`, `<memory:merge>`.
The engine parses these markers after the response is produced, applies
them to storage (under a per-file lock so concurrent writes do not corrupt
the JSON), strips them from the user-visible output, and persists the
applied operations on the run record.

This is the inference-only analogue of the GRPO-trained AgeMem policy —
the runtime does not learn the policy, but the agent now has direct
authority over the memory store rather than only the engine's heuristics.

## Trajectory-informed memory (arXiv:2603.10600, 2026)

`RunRecord.steps: TrajectoryStep[]` captures every attempt's component
moves: model invocation, each skill call, and the post-hoc memory tool
phase. Each step records `{ attempt, action, signal, durationMs,
observation }`. This implements the actionable-trajectory storage from
Trajectory-Informed Memory Generation (2026), letting future analysis
distinguish "task succeeded but a sub-step failed" from "task failed".
The web console run-detail panel and the new `ase run:show <id>` command
render the full trajectory.

## Retry uplift (SCoRe sanity check)

Recent work flags that LLM self-correction is "largely ineffective" in
modern models. To verify we are not in that regime, `SoulProfile` now
tracks `firstAttemptSuccesses`, `retryAttempts`, `retrySuccesses`, and a
derived `retryUplift = retrySuccesses / retryAttempts`. The retry loop is
worth keeping if uplift stays above the cost of an extra inference;
otherwise it should be disabled in `config.evolution.retryOnFailure`.

## Embedding cache and async queue

`src/runtime/embedding-cache.ts` keeps an on-disk cache keyed by SHA-256 of
the source text. Two callers benefit: query embedding during retrieval (kept
hot for repeated tasks) and per-memory embeddings written after each run.
Persistence is debounced through a 200 ms timer so that a burst of writes
costs a single fs flush. Background work for embedding and importance
re-scoring is dispatched onto a fire-and-forget queue so `runTask` never
blocks on the model endpoint after producing the user-visible output.

## A-Mem networked memory

`MemoryItem.links: string[]` follows the agentic memory graph in Xu et al.
2025. `topLinkCandidates` finds the k most relevant peers at write time and
`updateMemoryLinks` writes the edges bidirectionally. When
`config.evolution.oneHopExpansion` is on, retrieval pulls top-k base
memories and walks one hop along each item's links, scoring expanded peers
at half weight. This keeps the active context tight while still letting
indirectly relevant memories surface when the direct match is weak.

## LLM-graded importance

`src/runtime/importance-scorer.ts` mirrors the original Park et al. 2023
prompt: rate the memory on a 1–10 integer scale. The scorer runs in the
background queue and overwrites the heuristic score when it returns. If the
endpoint is unreachable or the response cannot be parsed, the heuristic
remains in place — the runtime stays correct without the model.

## Voyager-style playbooks

`src/runtime/playbooks.ts` implements a prompt-level analogue of the Voyager
skill library (Wang et al. 2023). When at least three similar tasks succeed,
the runtime synthesises a `Playbook` containing the trigger keywords, the
suggested skill order, the historical success rate, and a short prompt
template. On a new task, `selectPlaybook` chooses the best match (Jaccard
trigger overlap × 0.7 + success rate × 0.3) and the engine prepends the
playbook to the prompt while seeding the suggested skills. This is the safe
local analogue of executable skill synthesis: the agent learns *playbooks*,
not arbitrary code.

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

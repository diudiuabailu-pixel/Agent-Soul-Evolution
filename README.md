# Agent Soul Evolution

Agent Soul Evolution is an open-source local agent runtime for running task-focused agents with tools, memory, workflows, and continuous improvement loops on your own machine.

## What it does

- Connects to local or remote OpenAI-compatible models, including Ollama-compatible endpoints
- Runs agents through a lightweight runtime
- Executes built-in file, web, and shell skills during task runs
- Uses installable skills to extend what agents can do
- Stores results, reflections, lessons, and insights as memory
- Retrieves memory by a weighted recency × importance × relevance score
- Detects task failure, retries with verbal feedback, and updates a soul profile
- Consolidates recurring patterns into reusable insights every few runs
- Exposes a local web console for operations, agent settings, soul, and insights

The evolution system is grounded in published research; see
[`docs/RESEARCH.md`](docs/RESEARCH.md) for the mapping from each module to its
source paper.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Initialize local runtime data

```bash
npm run build
node dist/cli.js init
```

### 3. Start the runtime

```bash
node dist/cli.js start
```

The runtime will start on `http://localhost:3760`.

## CLI

```bash
node dist/cli.js init
node dist/cli.js start
node dist/cli.js doctor
node dist/cli.js run "List the files in this workspace"
node dist/cli.js run:show <run-id>
node dist/cli.js memory:list -n 10
node dist/cli.js runs:list -n 10
node dist/cli.js memory:consolidate
node dist/cli.js skill list
node dist/cli.js skill add web-fetch
node dist/cli.js skill install-path ./examples/echo-skill
node dist/cli.js ollama:list
node dist/cli.js eval
node dist/cli.js soul
node dist/cli.js soul:evolve
node dist/cli.js soul:export ./my-soul.json
node dist/cli.js soul:import ./my-soul.json
node dist/cli.js playbooks:list
node dist/cli.js playbooks:synthesize
node dist/cli.js prompt:evolve
node dist/cli.js memory:audit
node dist/cli.js memory:sign-existing
node dist/cli.js eval --file ./my-bench.json
node dist/cli.js config:set-model --base-url http://localhost:11434/v1 --model qwen2.5:7b
```

## Default skills

- `file-browser` — scans visible workspace entries
- `web-fetch` — fetches readable text when a task includes a URL
- `shell-command` — executes allowlisted commands wrapped in backticks

## Project structure

```text
bin/
src/
  cli.ts
  server.ts
  runtime/
  skills/
  web/
```

## Runtime data directory

The runtime stores local state in `./.runtime`. Persistent data lives in a
single SQLite database; legacy JSON files (if present from older versions)
are migrated on first start and renamed `.migrated`.

```text
.runtime/
  config.yaml
  store.sqlite           # memory, runs, insights, playbooks, agent, soul, notes
  memory/
    embeddings.json      # content-hash embedding cache (debounced)
  skills/
    packages/            # installed external skill packages
```

## Configuration

The generated `config.yaml` looks like this:

```yaml
server:
  port: 3760
models:
  default:
    provider: openai-compatible
    baseUrl: http://localhost:11434/v1
    model: qwen2.5:7b
skills:
  enabled:
    - file-browser
    - web-fetch
memory:
  maxItems: 500
evolution:
  retryOnFailure: true
  maxRetries: 1
  insightCadence: 5
  recencyHalfLifeHours: 168
  weightRecency: 1
  weightImportance: 1
  weightRelevance: 1
  useEmbeddings: false
  useCheckerModel: false
  consolidateOnEvolve: true
  useLlmImportance: false
  linkMemoriesOnWrite: true
  oneHopExpansion: true
  synthesizePlaybooks: true
  forestOfThoughtSamples: 1
  forestOfThoughtThreshold: 0.3
  memoryProvenance: false
```

`linkMemoriesOnWrite` builds an A-Mem-style memory graph. `oneHopExpansion`
walks a single hop from each top-k retrieval to surface indirectly relevant
context. `synthesizePlaybooks` clusters successful trajectories into reusable
prompt templates that get injected on similar future tasks. `useLlmImportance`
swaps the heuristic 1–10 score for the original Park et al. prompt and keeps
the heuristic as a fallback when the model is offline.

When `useEmbeddings` is on, the runtime calls the configured endpoint's
`/embeddings` route to score relevance with cosine similarity (Park et al.
2023). Token Jaccard is used as the fallback.

When `useCheckerModel` is on, a strict verifier prompt is sent to the model
after reflection (SAGE-style, Liang et al. 2025). The verifier issues a
`{ satisfied, confidence, reason }` verdict; success requires both the
heuristic reflection and the checker to agree.

## Web console

The built-in web console shows:

- Runtime status
- Enabled and available skills
- Workflow stages
- Recent runs and per-run detail
- Stored memory items with importance and access counts
- Agent profile editor
- Model configuration editor
- Ollama discovery
- Evaluation trigger and result summary
- Reflections produced by the runtime
- Soul identity, success rate, retry uplift, and evolution generations
- Top consolidated insights and a manual evolve trigger
- Synthesized playbooks (trigger, support, success rate, suggested skills)
- Per-run trajectory view: every model and skill step with signal + duration
- Memory operations the agent invoked via `<memory:store|retrieve|boost|discard|merge>` markers

## Installing a custom skill package

A skill package is a directory that contains a `skill.json` manifest. Install it with:

```bash
node dist/cli.js skill install-path /absolute/path/to/skill-package
```

The runtime copies the package into `.runtime/skills/packages/` and makes it visible in the console.

## Using a local model

If Ollama is running locally, point the runtime at its OpenAI-compatible endpoint:

```bash
ollama serve
node dist/cli.js config:set-model --base-url http://localhost:11434/v1 --model qwen2.5:7b
```

When a model is reachable, task runs will use the model response first and fall back to the local planner when the endpoint is unavailable.

## Evaluation

Run the default evaluation suite from the CLI:

```bash
node dist/cli.js eval
```

The suite runs a small set of runtime checks against built-in file and shell flows and reports pass/fail results.

## Tests

```bash
npm test
```

Builds and runs the unit suite under Node's built-in test runner. Coverage
spans memory retrieval scoring, reflection signal detection, insight
reconciliation, soul aggregation, and the heuristic checker.

## MCP server (use this runtime as any MCP client's memory backend)

```bash
node dist/cli.js mcp
```

Starts an [MCP](https://modelcontextprotocol.io) stdio server that exposes the
soul's memory, insights, playbooks, and run engine as tools and resources.

**Tools:** `memory_store`, `memory_retrieve`, `memory_boost`, `memory_discard`,
`memory_merge`, `run_task`, `soul_status`, `soul_evolve`, `playbooks_list`,
`playbooks_synthesize`.

**Resources:** `agent-soul://soul/profile`, `agent-soul://insights/top`,
`agent-soul://playbooks/active`, `agent-soul://memory/recent`,
`agent-soul://runs/recent`.

Register with Claude Code (`~/.claude.json`):

```json
{
  "mcpServers": {
    "agent-soul": {
      "command": "node",
      "args": ["/absolute/path/to/Agent-Soul-Evolution/dist/cli.js", "mcp"]
    }
  }
}
```

The same JSON shape works for any MCP-aware client (Cursor, Codex CLI,
Continue, Gemini CLI). Once registered the agent can call
`memory_store` / `memory_retrieve` / `run_task` directly, and read live
soul state through the resource URIs.

## Roadmap

- Workflow editor
- Scheduled tasks
- Deeper evaluation suites and automatic routing
- External skill execution hooks
- Optional multi-agent orchestration

## License

MIT

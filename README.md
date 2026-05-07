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
node dist/cli.js skill list
node dist/cli.js skill add web-fetch
node dist/cli.js skill install-path ./examples/echo-skill
node dist/cli.js ollama:list
node dist/cli.js eval
node dist/cli.js soul
node dist/cli.js soul:evolve
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

The runtime stores local state in `./.runtime`.

```text
.runtime/
  config.yaml
  agents/
  memory/
  runs/
  skills/
    installed.json
    packages/
  soul/
    profile.json
    insights.json
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
```

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
- Soul identity, success rate, and evolution generations
- Top consolidated insights and a manual evolve trigger

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

## Roadmap

- Workflow editor
- Scheduled tasks
- Deeper evaluation suites and automatic routing
- External skill execution hooks
- Optional multi-agent orchestration

## License

MIT

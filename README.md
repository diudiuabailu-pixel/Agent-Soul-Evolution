# Agent Soul Evolution

Agent Soul Evolution is an open-source local agent runtime for running task-focused agents with tools, memory, workflows, and continuous improvement loops on your own machine.

## What it does

- Connects to local or remote OpenAI-compatible models
- Runs agents through a lightweight runtime
- Uses installable skills to extend what agents can do
- Stores memory from finished runs
- Generates reflections after each task
- Exposes a local web console for operations and inspection

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
```

## Default skills

- `file-browser`
- `web-fetch`
- `shell-command`

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
```

## Web console

The built-in web console shows:

- Runtime status
- Enabled skills
- Recent runs
- Stored memory items
- Reflections produced by the runtime

## Roadmap

- Native Ollama model checks
- Workflow editor
- Scheduled tasks
- Evaluation suites and automatic routing
- Optional multi-agent orchestration

## License

MIT

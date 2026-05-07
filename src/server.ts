import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntime, loadMemory, loadRuns, loadInstalledSkills, loadConfig, loadAgent, saveAgent, saveConfig } from './runtime/storage.js';
import { skillCatalog } from './skills/catalog.js';
import { runTask } from './runtime/engine.js';
import { defaultWorkflow } from './runtime/workflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.join(__dirname, '../src/web');

export async function createServer() {
  await ensureRuntime();
  const config = await loadConfig();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(webRoot));

  app.get('/api/state', async (_req, res) => {
    const [memory, runs, installedSkills, agent, currentConfig] = await Promise.all([
      loadMemory(),
      loadRuns(),
      loadInstalledSkills(),
      loadAgent(),
      loadConfig()
    ]);

    const skills = installedSkills
      .map((id) => skillCatalog.find((skill) => skill.id === id))
      .filter(Boolean);

    res.json({ memory, runs, skills, agent, config: currentConfig, workflow: defaultWorkflow });
  });

  app.post('/api/run', async (req, res) => {
    const task = String(req.body?.task || '').trim();
    if (!task) {
      res.status(400).json({ error: 'Task is required.' });
      return;
    }

    const run = await runTask(task);
    res.json(run);
  });

  app.post('/api/agent', async (req, res) => {
    const current = await loadAgent();
    const next = {
      ...current,
      ...req.body,
      preferredSkills: Array.isArray(req.body?.preferredSkills) ? req.body.preferredSkills : current.preferredSkills
    };
    await saveAgent(next);
    res.json(next);
  });

  app.post('/api/config', async (req, res) => {
    const current = await loadConfig();
    const next = {
      ...current,
      ...req.body,
      server: { ...current.server, ...(req.body?.server || {}) },
      memory: { ...current.memory, ...(req.body?.memory || {}) },
      models: {
        ...current.models,
        default: { ...current.models.default, ...(req.body?.models?.default || {}) }
      },
      skills: {
        ...current.skills,
        enabled: Array.isArray(req.body?.skills?.enabled) ? req.body.skills.enabled : current.skills.enabled
      }
    };
    await saveConfig(next);
    res.json(next);
  });

  app.use((_req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
  });

  return {
    app,
    port: config.server.port
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().then(({ app, port }) => {
    app.listen(port, () => {
      console.log(`Agent Soul Evolution running on http://localhost:${port}`);
    });
  });
}

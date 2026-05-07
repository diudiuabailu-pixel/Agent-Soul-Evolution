import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntime, loadMemory, loadRuns, loadInstalledSkills, loadConfig, loadAgent, saveAgent, saveConfig, installSkill } from './runtime/storage.js';
import { runTask } from './runtime/engine.js';
import { loadAllSkillManifests, installSkillPackage } from './runtime/discovery.js';
import { runEvalSuite } from './runtime/eval.js';
import { listOllamaModels } from './runtime/ollama.js';
import { getRunById } from './runtime/run-details.js';
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
    const [memory, runs, installedSkills, agent, currentConfig, allSkills] = await Promise.all([
      loadMemory(),
      loadRuns(),
      loadInstalledSkills(),
      loadAgent(),
      loadConfig(),
      loadAllSkillManifests()
    ]);

    const skills = installedSkills
      .map((id) => allSkills.find((skill) => skill.id === id))
      .filter(Boolean);

    res.json({ memory, runs, skills, agent, config: currentConfig, workflow: defaultWorkflow, availableSkills: allSkills });
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

  app.get('/api/ollama/models', async (_req, res) => {
    try {
      const models = await listOllamaModels();
      res.json({ models });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/skills/install-path', async (req, res) => {
    try {
      const sourceDir = String(req.body?.sourceDir || '').trim();
      if (!sourceDir) {
        res.status(400).json({ error: 'sourceDir is required' });
        return;
      }
      const manifest = await installSkillPackage(sourceDir);
      await installSkill(manifest.id);
      res.json({ manifest });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/runs/:id', async (req, res) => {
    const run = await getRunById(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  });

  app.post('/api/eval', async (_req, res) => {
    const result = await runEvalSuite();
    res.json(result);
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

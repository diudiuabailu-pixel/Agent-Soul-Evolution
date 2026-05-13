import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureRuntime,
  loadMemory,
  loadRuns,
  loadInstalledSkills,
  loadConfig,
  loadAgent,
  loadPlaybooks,
  saveAgent,
  saveConfig,
  savePlaybooks,
  installSkill,
  loadInsights,
  loadSoulProfile,
  saveInsights,
  saveSoulProfile
} from './runtime/storage.js';
import { runTask } from './runtime/engine.js';
import { loadAllSkillManifests, installSkillPackage } from './runtime/discovery.js';
import { runEvalSuite } from './runtime/eval.js';
import { listOllamaModels } from './runtime/ollama.js';
import { getRunById } from './runtime/run-details.js';
import { defaultWorkflow } from './runtime/workflow.js';
import { deriveCandidateInsights, reconcileInsights } from './runtime/insights.js';
import { deriveCandidatePlaybooks, reconcilePlaybooks } from './runtime/playbooks.js';
import { recordEvolution, refreshIdentity } from './runtime/soul.js';
import { runEvents } from './runtime/events.js';

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
    const [memory, runs, installedSkills, agent, currentConfig, allSkills, insights, soul, playbooks] = await Promise.all([
      loadMemory(),
      loadRuns(),
      loadInstalledSkills(),
      loadAgent(),
      loadConfig(),
      loadAllSkillManifests(),
      loadInsights(),
      loadSoulProfile(),
      loadPlaybooks()
    ]);

    const skills = installedSkills
      .map((id) => allSkills.find((skill) => skill.id === id))
      .filter(Boolean);

    res.json({
      memory,
      runs,
      skills,
      agent,
      config: currentConfig,
      workflow: defaultWorkflow,
      availableSkills: allSkills,
      insights,
      soul,
      playbooks
    });
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
      },
      evolution: { ...current.evolution, ...(req.body?.evolution || {}) }
    };
    await saveConfig(next);
    res.json(next);
  });

  app.get('/api/soul', async (_req, res) => {
    const [soul, insights] = await Promise.all([loadSoulProfile(), loadInsights()]);
    res.json({ soul, insights });
  });

  app.get('/api/playbooks', async (_req, res) => {
    const playbooks = await loadPlaybooks();
    res.json({ playbooks });
  });

  app.post('/api/playbooks/synthesize', async (_req, res) => {
    const [runs, existing] = await Promise.all([loadRuns(), loadPlaybooks()]);
    const candidates = deriveCandidatePlaybooks(runs.slice(0, 60));
    const next = reconcilePlaybooks(existing, candidates);
    await savePlaybooks(next);
    res.json({ playbooks: next, added: next.length - existing.length });
  });

  app.post('/api/soul/evolve', async (_req, res) => {
    const [runs, existing, profile, agent] = await Promise.all([
      loadRuns(),
      loadInsights(),
      loadSoulProfile(),
      loadAgent()
    ]);
    const candidates = deriveCandidateInsights(runs.slice(0, 20));
    const { next, ops } = reconcileInsights(existing, candidates);
    await saveInsights(next);
    const evolved = recordEvolution(profile);
    const refreshed = refreshIdentity(evolved, agent, next);
    await saveSoulProfile(refreshed);
    res.json({ insights: next, soul: refreshed, operations: ops });
  });

  app.post('/a2a/messages', async (req, res) => {
    const envelope = req.body ?? {};
    const message = envelope?.message ?? envelope;
    const textPart = Array.isArray(message?.parts)
      ? message.parts.find((part: { type?: string; text?: string }) => part?.type === 'text' && typeof part?.text === 'string')
      : null;
    const inferredText = typeof message?.content === 'string' ? message.content : textPart?.text;
    const task = typeof inferredText === 'string' && inferredText.trim().length > 0
      ? inferredText.trim()
      : typeof envelope?.task === 'string' ? envelope.task : '';
    if (!task) {
      res.status(400).json({ error: 'A2A envelope must include message.parts[].text, message.content, or task.' });
      return;
    }
    try {
      const run = await runTask(task);
      res.json({
        protocol: 'a2a/v1',
        message: {
          role: 'agent',
          parts: [
            { type: 'text', text: run.output },
            { type: 'text', text: `Reflection: ${run.reflection}` }
          ],
          metadata: {
            runId: run.id,
            status: run.status,
            attempts: run.attempts,
            usedSkills: run.usedSkills,
            checkerVerdict: run.checkerVerdict
          }
        }
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/a2a/agent-card', (_req, res) => {
    res.json({
      protocol: 'a2a/v1',
      name: 'agent-soul-evolution',
      version: '0.2.0',
      description: 'Local self-evolving agent runtime with memory, insights, playbooks, and reflection.',
      capabilities: ['memory.retrieve', 'memory.store', 'run.execute', 'soul.evolve']
    });
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: ping\ndata: ${JSON.stringify({ now: new Date().toISOString() })}\n\n`);
    const listener = (event: unknown) => {
      try {
        res.write(`event: run\ndata: ${JSON.stringify(event)}\n\n`);
      } catch { /* client disconnected */ }
    };
    runEvents.on('event', listener);
    const heartbeat = setInterval(() => {
      try { res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`); } catch { /* ignore */ }
    }, 15_000);
    req.on('close', () => {
      runEvents.off('event', listener);
      clearInterval(heartbeat);
      res.end();
    });
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

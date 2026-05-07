import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntime, loadMemory, loadRuns, loadInstalledSkills, loadConfig } from './runtime/storage.js';
import { skillCatalog } from './skills/catalog.js';
import { runTask } from './runtime/engine.js';

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
    const [memory, runs, installedSkills] = await Promise.all([
      loadMemory(),
      loadRuns(),
      loadInstalledSkills()
    ]);

    const skills = installedSkills
      .map((id) => skillCatalog.find((skill) => skill.id === id))
      .filter(Boolean);

    res.json({ memory, runs, skills });
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

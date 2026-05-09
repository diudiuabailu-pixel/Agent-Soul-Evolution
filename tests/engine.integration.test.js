import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const projectDir = process.cwd();

function startFakeModel({ chatResponses = [], embedding = [0.1, 0.2, 0.3], importance = '7' } = {}) {
  let chatIndex = 0;
  const calls = { chat: 0, embeddings: 0 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        if (req.url === '/v1/chat/completions') {
          calls.chat += 1;
          const userContent = payload.messages?.[1]?.content || '';
          const text = userContent.includes('single JSON object')
            ? '{"satisfied":true,"confidence":0.85,"reason":"matches task"}'
            : userContent.includes('Rate how important')
              ? importance
              : (chatResponses[chatIndex++] ?? 'Workspace entries:\n- README.md\nResult: handled.');
          const responseBody = JSON.stringify({
            choices: [{ message: { content: text } }]
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(responseBody);
          return;
        }
        if (req.url === '/v1/embeddings') {
          calls.embeddings += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ embedding }] }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port, calls });
    });
  });
}

async function withTempRuntime(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ase-int-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tempDir);
    await callback(tempDir);
  } finally {
    process.chdir(originalCwd);
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* swallow cleanup races */
    }
  }
}

async function importFresh() {
  const cacheBuster = Date.now() + Math.random();
  const engine = await import(`${path.join(projectDir, 'dist/runtime/engine.js')}?t=${cacheBuster}`);
  const storage = await import(`${path.join(projectDir, 'dist/runtime/storage.js')}?t=${cacheBuster}`);
  const cache = await import(`${path.join(projectDir, 'dist/runtime/embedding-cache.js')}?t=${cacheBuster}`);
  return { engine, storage, cache };
}

test('engine runs end-to-end against a fake model endpoint', async () => {
  await withTempRuntime(async () => {
    const { server, port, calls } = await startFakeModel();
    try {
      const { engine, storage, cache } = await importFresh();
      await storage.ensureRuntime();
      const config = await storage.loadConfig();
      config.models.default.baseUrl = `http://127.0.0.1:${port}/v1`;
      config.models.default.model = 'fake-model';
      config.evolution.useEmbeddings = true;
      config.evolution.useCheckerModel = true;
      config.evolution.useLlmImportance = true;
      config.evolution.linkMemoriesOnWrite = true;
      config.evolution.oneHopExpansion = true;
      config.evolution.synthesizePlaybooks = true;
      await storage.saveConfig(config);

      const run = await engine.runTask('List the visible workspace files and summarize the next step.');
      assert.equal(run.status, 'completed');
      assert.equal(run.attempts, 1);
      assert.ok(run.usedSkills.includes('file-browser'));
      assert.ok(run.checkerVerdict);
      assert.equal(run.checkerVerdict.source, 'model');
      assert.equal(run.checkerVerdict.satisfied, true);

      // wait briefly for background embedding/importance jobs
      await new Promise((resolve) => setTimeout(resolve, 250));
      while (cache.pendingEmbeddingJobs() > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await cache.flushEmbeddings();

      const memory = await storage.loadMemory();
      const persistedRuns = await storage.loadRuns();
      assert.equal(persistedRuns.length, 1);
      assert.ok(memory.length >= 3);
      const lesson = memory.find((item) => item.kind === 'lesson');
      assert.ok(lesson, 'lesson memory should exist');
      assert.ok(Array.isArray(lesson.embedding) && lesson.embedding.length === 3);
      assert.equal(lesson.importance, 7);

      const soul = await storage.loadSoulProfile();
      assert.equal(soul.runs, 1);
      assert.equal(soul.successes, 1);

      assert.ok(calls.chat > 0, 'chat endpoint should have been hit');
      assert.ok(calls.embeddings > 0, 'embeddings endpoint should have been hit');
    } finally {
      server.close();
    }
  });
});

test('engine retries once on a failure signal and recovers', async () => {
  await withTempRuntime(async () => {
    const { server, port } = await startFakeModel({
      chatResponses: [
        'No URL was present in the task, so no web content was fetched.',
        'Workspace entries:\n- README.md\nResult: recovered on retry.'
      ]
    });
    try {
      const { engine, storage } = await importFresh();
      await storage.ensureRuntime();
      const config = await storage.loadConfig();
      config.models.default.baseUrl = `http://127.0.0.1:${port}/v1`;
      config.models.default.model = 'fake-model';
      config.evolution.useEmbeddings = false;
      config.evolution.useCheckerModel = false;
      config.evolution.useLlmImportance = false;
      config.evolution.linkMemoriesOnWrite = false;
      config.evolution.synthesizePlaybooks = false;
      await storage.saveConfig(config);

      const run = await engine.runTask('Inspect the workspace folder layout and summarize.');
      assert.ok(run.attempts >= 2, `expected retry, got ${run.attempts}`);
      assert.equal(run.status, 'completed');
    } finally {
      server.close();
    }
  });
});

test('runTask captures trajectory steps and applies agent memory ops', async () => {
  await withTempRuntime(async () => {
    const responseWithOps = [
      'Workspace entries:',
      '- README.md',
      '- src',
      'Result: I will remember this for next time.',
      '<memory:store kind="lesson" importance="9" tags="workspace">Always cite README first when summarizing the workspace.</memory:store>'
    ].join('\n');
    const { server, port } = await startFakeModel({ chatResponses: [responseWithOps] });
    try {
      const { engine, storage } = await importFresh();
      await storage.ensureRuntime();
      const config = await storage.loadConfig();
      config.models.default.baseUrl = `http://127.0.0.1:${port}/v1`;
      config.models.default.model = 'fake-model';
      config.evolution.useEmbeddings = false;
      config.evolution.useCheckerModel = false;
      config.evolution.useLlmImportance = false;
      config.evolution.linkMemoriesOnWrite = false;
      config.evolution.synthesizePlaybooks = false;
      await storage.saveConfig(config);

      const run = await engine.runTask('List the visible workspace files');
      assert.ok(Array.isArray(run.steps) && run.steps.length > 0, 'should capture trajectory steps');
      assert.ok(run.steps.some((step) => step.action === 'model.invoke'), 'should record model invocation');
      assert.ok(run.steps.some((step) => step.action.startsWith('skill.')), 'should record skill invocation');

      assert.ok(Array.isArray(run.memoryOps), 'memoryOps should exist');
      assert.equal(run.memoryOps.length, 1);
      assert.equal(run.memoryOps[0].kind, 'store');

      assert.ok(!run.output.includes('<memory:store'), 'marker should be cleaned from final output');

      const memory = await storage.loadMemory();
      const stored = memory.find((item) => item.tags.includes('agent-tool'));
      assert.ok(stored, 'agent-stored memory should be persisted');
      assert.equal(stored.importance, 9);

      const soul = await storage.loadSoulProfile();
      assert.equal(soul.firstAttemptSuccesses, 1);
      assert.equal(soul.retryAttempts, 0);
    } finally {
      server.close();
    }
  });
});

test('soul tracks retry uplift after a recovered failure', async () => {
  await withTempRuntime(async () => {
    const { server, port } = await startFakeModel({
      chatResponses: [
        'No URL was present in the task, so no web content was fetched.',
        'Workspace entries:\n- README.md\nResult: recovered on retry.'
      ]
    });
    try {
      const { engine, storage } = await importFresh();
      await storage.ensureRuntime();
      const config = await storage.loadConfig();
      config.models.default.baseUrl = `http://127.0.0.1:${port}/v1`;
      config.models.default.model = 'fake-model';
      config.evolution.useEmbeddings = false;
      config.evolution.useCheckerModel = false;
      config.evolution.useLlmImportance = false;
      config.evolution.linkMemoriesOnWrite = false;
      config.evolution.synthesizePlaybooks = false;
      await storage.saveConfig(config);

      const run = await engine.runTask('Inspect the workspace folder layout and summarize.');
      assert.ok(run.attempts >= 2, 'should retry once');
      const soul = await storage.loadSoulProfile();
      assert.equal(soul.retryAttempts, 1);
      assert.equal(soul.retrySuccesses, 1);
      assert.ok(Math.abs(soul.retryUplift - 1) < 1e-9);
      assert.equal(soul.firstAttemptSuccesses, 0);
    } finally {
      server.close();
    }
  });
});

test('embedding cache short-circuits a second identical request', async () => {
  await withTempRuntime(async () => {
    const { server, port, calls } = await startFakeModel();
    try {
      const { storage, cache } = await importFresh();
      await storage.ensureRuntime();
      const config = await storage.loadConfig();
      config.models.default.baseUrl = `http://127.0.0.1:${port}/v1`;
      await storage.saveConfig(config);

      const a = await cache.embedWithCache('hello world');
      const b = await cache.embedWithCache('hello world');
      assert.deepEqual(a, b);
      assert.equal(calls.embeddings, 1, 'second call should be served from cache');
    } finally {
      server.close();
    }
  });
});

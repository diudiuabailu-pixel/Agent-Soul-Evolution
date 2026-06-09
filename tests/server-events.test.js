import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const projectDir = process.cwd();

async function withTempRuntime(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ase-srv-'));
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
      /* ignore */
    }
  }
}

async function importFresh() {
  const t = Date.now() + Math.random();
  return {
    server: await import(`${path.join(projectDir, 'dist/server.js')}?t=${t}`),
    storage: await import(`${path.join(projectDir, 'dist/runtime/storage.js')}?t=${t}`),
    events: await import(`${path.join(projectDir, 'dist/runtime/events.js')}?t=${t}`)
  };
}

test('A2A receiver runs a task and returns an A2A envelope', async () => {
  await withTempRuntime(async () => {
    const { server, storage } = await importFresh();
    await storage.ensureRuntime();
    const { app, port } = await server.createServer();
    const handle = app.listen(0);
    const realPort = handle.address().port;
    try {
      const response = await fetch(`http://127.0.0.1:${realPort}/a2a/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { role: 'user', parts: [{ type: 'text', text: 'List the visible workspace files.' }] } })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.protocol, 'a2a/v1');
      assert.equal(body.message.role, 'agent');
      assert.ok(Array.isArray(body.message.parts) && body.message.parts.length > 0);
      assert.ok(body.message.metadata.runId);
    } finally {
      handle.close();
    }
  });
});

test('agent-card endpoint returns expected metadata', async () => {
  await withTempRuntime(async () => {
    const { server, storage } = await importFresh();
    await storage.ensureRuntime();
    const { app } = await server.createServer();
    const handle = app.listen(0);
    const realPort = handle.address().port;
    try {
      const response = await fetch(`http://127.0.0.1:${realPort}/a2a/agent-card`);
      const body = await response.json();
      assert.equal(body.protocol, 'a2a/v1');
      assert.equal(body.name, 'agent-soul-evolution');
      assert.ok(Array.isArray(body.capabilities) && body.capabilities.includes('memory.retrieve'));
    } finally {
      handle.close();
    }
  });
});

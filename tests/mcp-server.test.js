import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const projectDir = process.cwd();

async function withTempRuntime(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ase-mcp-'));
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
  const mcp = await import(`${path.join(projectDir, 'dist/mcp-server.js')}?t=${cacheBuster}`);
  const storage = await import(`${path.join(projectDir, 'dist/runtime/storage.js')}?t=${cacheBuster}`);
  return { mcp, storage };
}

async function connectInMemory(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return { client };
}

test('MCP server lists expected tools and resources', async () => {
  await withTempRuntime(async () => {
    const { mcp, storage } = await importFresh();
    await storage.ensureRuntime();
    const server = mcp.buildMcpServer();
    const { client } = await connectInMemory(server);
    try {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name).sort();
      for (const expected of [
        'memory_store',
        'memory_retrieve',
        'memory_boost',
        'memory_discard',
        'memory_merge',
        'run_task',
        'soul_status',
        'soul_evolve',
        'playbooks_list',
        'playbooks_synthesize'
      ]) {
        assert.ok(toolNames.includes(expected), `expected tool ${expected} to be registered`);
      }

      const resources = await client.listResources();
      const resourceUris = resources.resources.map((resource) => resource.uri).sort();
      for (const expected of [
        'agent-soul://soul/profile',
        'agent-soul://insights/top',
        'agent-soul://playbooks/active',
        'agent-soul://memory/recent',
        'agent-soul://runs/recent'
      ]) {
        assert.ok(resourceUris.includes(expected), `expected resource ${expected} to be registered`);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

test('MCP memory_store and memory_retrieve round-trip', async () => {
  await withTempRuntime(async () => {
    const { mcp, storage } = await importFresh();
    await storage.ensureRuntime();
    const server = mcp.buildMcpServer();
    const { client } = await connectInMemory(server);
    try {
      const stored = await client.callTool({
        name: 'memory_store',
        arguments: {
          kind: 'lesson',
          task: 'workspace inspection',
          content: 'Always cite README first when summarizing the workspace.',
          importance: 8,
          tags: ['workspace']
        }
      });
      assert.equal(stored.isError, undefined);
      const storedPayload = JSON.parse(stored.content[0].text);
      assert.ok(typeof storedPayload.id === 'string' && storedPayload.id.length > 0);
      assert.equal(storedPayload.importance, 8);

      const retrieved = await client.callTool({
        name: 'memory_retrieve',
        arguments: { query: 'workspace readme', k: 5 }
      });
      const retrievedPayload = JSON.parse(retrieved.content[0].text);
      assert.ok(Array.isArray(retrievedPayload.items) && retrievedPayload.items.length > 0);
      const found = retrievedPayload.items.find((entry) => entry.id === storedPayload.id);
      assert.ok(found, 'newly stored memory should be retrievable');
      assert.equal(found.importance, 8);
      assert.ok(found.components.relevance >= 0);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

test('MCP soul_status returns a valid summary on a fresh runtime', async () => {
  await withTempRuntime(async () => {
    const { mcp, storage } = await importFresh();
    await storage.ensureRuntime();
    const server = mcp.buildMcpServer();
    const { client } = await connectInMemory(server);
    try {
      const result = await client.callTool({ name: 'soul_status', arguments: {} });
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.soul.runs, 0);
      assert.match(payload.summary, /runs=0/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

test('MCP resource read returns soul profile JSON', async () => {
  await withTempRuntime(async () => {
    const { mcp, storage } = await importFresh();
    await storage.ensureRuntime();
    const server = mcp.buildMcpServer();
    const { client } = await connectInMemory(server);
    try {
      const result = await client.readResource({ uri: 'agent-soul://soul/profile' });
      assert.equal(result.contents.length, 1);
      const profile = JSON.parse(result.contents[0].text);
      assert.equal(profile.runs, 0);
      assert.equal(profile.generations, 0);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

test('MCP memory_boost adjusts importance and is reflected in retrieve', async () => {
  await withTempRuntime(async () => {
    const { mcp, storage } = await importFresh();
    await storage.ensureRuntime();
    const server = mcp.buildMcpServer();
    const { client } = await connectInMemory(server);
    try {
      const stored = await client.callTool({
        name: 'memory_store',
        arguments: { kind: 'lesson', task: 't', content: 'unique-text-marker', importance: 5 }
      });
      const id = JSON.parse(stored.content[0].text).id;

      const boosted = await client.callTool({
        name: 'memory_boost',
        arguments: { id, delta: 3 }
      });
      const boostedPayload = JSON.parse(boosted.content[0].text);
      assert.equal(boostedPayload.importance, 8);

      const retrieved = await client.callTool({
        name: 'memory_retrieve',
        arguments: { query: 'unique-text-marker', k: 3 }
      });
      const payload = JSON.parse(retrieved.content[0].text);
      const found = payload.items.find((entry) => entry.id === id);
      assert.ok(found);
      assert.equal(found.importance, 8);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

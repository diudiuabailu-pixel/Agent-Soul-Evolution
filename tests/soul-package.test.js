import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const projectDir = process.cwd();

async function withTempRuntime(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ase-pack-'));
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
  const storage = await import(`${path.join(projectDir, 'dist/runtime/storage.js')}?t=${t}`);
  const pkg = await import(`${path.join(projectDir, 'dist/runtime/soul-package.js')}?t=${t}`);
  return { storage, pkg };
}

test('soul package round-trips memory, insights, and playbooks', async () => {
  await withTempRuntime(async (sourceDir) => {
    const { storage, pkg } = await importFresh();
    await storage.ensureRuntime();
    await storage.appendMemory({ kind: 'lesson', task: 'export-task', content: 'rule X', tags: ['exported'] });
    await storage.saveInsights([{ id: 'i1', content: 'insight one', support: 3, confidence: 0.7, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), origins: [], tags: [] }]);
    await storage.savePlaybooks([{ id: 'p1', title: 'pb', trigger: 'export', prompt: 'do x', suggestedSkills: ['file-browser'], support: 4, successRate: 0.9, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), origins: [] }]);

    const exportPath = path.join(sourceDir, 'soul-export.json');
    const exported = await pkg.exportSoul(exportPath);
    assert.ok(exported.bytes > 0);

    // Re-import into a fresh runtime
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ase-pack-target-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(targetDir);
      const fresh = await importFresh();
      await fresh.storage.ensureRuntime();
      const result = await fresh.pkg.importSoul(exportPath, { merge: false });
      assert.equal(result.memory, 1);
      assert.equal(result.insights, 1);
      assert.equal(result.playbooks, 1);

      const memory = await fresh.storage.loadMemory();
      const insights = await fresh.storage.loadInsights();
      const playbooks = await fresh.storage.loadPlaybooks();
      assert.ok(memory.some((entry) => entry.tags.includes('exported')));
      assert.equal(insights.length, 1);
      assert.equal(playbooks.length, 1);
    } finally {
      process.chdir(previousCwd);
      try { await fs.rm(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch {}
    }
  });
});

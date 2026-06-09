import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const projectDir = process.cwd();

async function withTempRuntime(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ase-gov-'));
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
  const governance = await import(`${path.join(projectDir, 'dist/runtime/governance.js')}?t=${t}`);
  return { storage, governance };
}

test('governance backfill signs all unsigned memories and audit confirms', async () => {
  await withTempRuntime(async () => {
    const { storage, governance } = await importFresh();
    await storage.ensureRuntime();
    await storage.appendMemory({ kind: 'lesson', task: 't1', content: 'lesson one', tags: [] });
    await storage.appendMemory({ kind: 'result', task: 't2', content: 'result two', tags: [] });

    const beforeAudit = await governance.auditMemoryProvenance();
    assert.equal(beforeAudit.unsigned, 2);
    assert.equal(beforeAudit.signed, 0);

    const touched = await governance.backfillProvenance('test');
    assert.equal(touched, 2);

    const afterAudit = await governance.auditMemoryProvenance();
    assert.equal(afterAudit.signed, 2);
    assert.equal(afterAudit.tampered.length, 0);
  });
});

test('governance audit detects tampered memory content', async () => {
  await withTempRuntime(async () => {
    const { storage, governance } = await importFresh();
    await storage.ensureRuntime();
    const stored = await storage.appendMemory({ kind: 'lesson', task: 'tx', content: 'pristine', tags: [] });
    await governance.backfillProvenance('test');
    const items = await storage.loadMemory();
    const target = items.find((item) => item.id === stored.id);
    target.content = 'tampered';
    await storage.saveMemoryItems([target, ...items.filter((item) => item.id !== stored.id)]);
    // saveMemoryItems wipes provenance via the existing fields; reattach the original signature
    const dbModule = await import(`${path.join(projectDir, 'dist/runtime/db.js')}?t=${Date.now()}`);
    dbModule.getDb().prepare('UPDATE memory SET provenance = ? WHERE id = ?').run(JSON.stringify(target.provenance), target.id);
    const audit = await governance.auditMemoryProvenance();
    assert.ok(audit.tampered.some((entry) => entry.id === stored.id));
  });
});

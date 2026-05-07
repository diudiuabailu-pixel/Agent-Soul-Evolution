import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRunOutcome } from '../dist/runtime/checker.js';

test('heuristic checker accepts a clearly satisfied output', async () => {
  const verdict = await checkRunOutcome(
    'List the files in this workspace',
    'Workspace files include README.md, src, and package.json which describe this workspace.',
    { success: true, observation: '', lesson: '', importance: 5, signals: [] },
    { useModel: false }
  );
  assert.equal(verdict.satisfied, true);
  assert.equal(verdict.source, 'heuristic');
  assert.ok(verdict.confidence > 0.4);
});

test('heuristic checker rejects an obviously unrelated short output', async () => {
  const verdict = await checkRunOutcome(
    'List the files in this workspace',
    'no',
    { success: false, observation: '', lesson: '', importance: 5, signals: ['execution failed'] },
    { useModel: false }
  );
  assert.equal(verdict.satisfied, false);
  assert.equal(verdict.source, 'heuristic');
});

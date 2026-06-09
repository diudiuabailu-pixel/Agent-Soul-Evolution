import test from 'node:test';
import assert from 'node:assert/strict';
import { evolvePlaybooks, selectPlaybook } from '../dist/runtime/playbooks.js';

function makePlaybook(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    trigger: overrides.trigger,
    prompt: overrides.prompt || '',
    suggestedSkills: overrides.suggestedSkills || [],
    support: overrides.support ?? 3,
    successRate: overrides.successRate ?? 1,
    createdAt: '',
    updatedAt: '',
    origins: overrides.origins || [],
    parentId: overrides.parentId,
    childIds: overrides.childIds
  };
}

function makeRun(overrides) {
  return {
    id: overrides.id,
    task: overrides.task || 'task',
    status: overrides.status || 'completed',
    usedSkills: overrides.usedSkills || [],
    reflectionDetail: { success: overrides.status !== 'failed' }
  };
}

test('evolvePlaybooks marks a degraded playbook as fixed', () => {
  const playbooks = [makePlaybook({
    id: 'p1', title: 'pb', trigger: 'workspace files', suggestedSkills: ['file-browser'],
    support: 5, successRate: 1, origins: ['r1', 'r2', 'r3', 'r4']
  })];
  const recentRuns = [
    makeRun({ id: 'r1', status: 'failed' }),
    makeRun({ id: 'r2', status: 'failed' }),
    makeRun({ id: 'r3', status: 'failed' }),
    makeRun({ id: 'r4', status: 'completed' })
  ];
  const result = evolvePlaybooks(playbooks, recentRuns);
  assert.ok(result.ops.some((op) => op.kind === 'fixed' && op.id === 'p1'));
  assert.ok(result.next[0].prompt.includes('FIX:'));
});

test('evolvePlaybooks derives a parent when two siblings overlap', () => {
  const playbooks = [
    makePlaybook({ id: 'a', title: 'A', trigger: 'workspace files list', suggestedSkills: ['file-browser'] }),
    makePlaybook({ id: 'b', title: 'B', trigger: 'workspace files browse', suggestedSkills: ['file-browser'] })
  ];
  const result = evolvePlaybooks(playbooks, []);
  const derived = result.ops.find((op) => op.kind === 'derived');
  assert.ok(derived);
  const parent = result.next.find((entry) => entry.id === derived.child.id);
  assert.ok(parent);
  assert.deepEqual(parent.childIds, ['a', 'b']);
  const child = result.next.find((entry) => entry.id === 'a');
  assert.equal(child.parentId, derived.child.id);
});

test('selectPlaybook descends from a parent to its more specific child', () => {
  const child = makePlaybook({ id: 'c', title: 'child', trigger: 'workspace files list quickly', suggestedSkills: ['file-browser'], parentId: 'p' });
  const parent = makePlaybook({ id: 'p', title: 'parent', trigger: 'workspace files', suggestedSkills: ['file-browser'], childIds: ['c'] });
  const result = selectPlaybook([parent, child], 'list workspace files quickly');
  assert.ok(result);
  assert.equal(result.id, 'c');
});

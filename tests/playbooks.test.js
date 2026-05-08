import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCandidatePlaybooks,
  reconcilePlaybooks,
  selectPlaybook
} from '../dist/runtime/playbooks.js';

function makeRun(overrides) {
  return {
    id: overrides.id || 'r',
    task: overrides.task || 'do work',
    output: overrides.output || '',
    status: overrides.status || 'completed',
    usedSkills: overrides.usedSkills || [],
    reflection: overrides.reflection || '',
    attempts: 1,
    reflectionDetail: overrides.reflectionDetail || { success: overrides.status !== 'failed' }
  };
}

test('deriveCandidatePlaybooks needs at least three similar successes', () => {
  const fewer = [
    makeRun({ id: '1', task: 'list workspace files now', usedSkills: ['file-browser'] }),
    makeRun({ id: '2', task: 'list workspace files please', usedSkills: ['file-browser'] })
  ];
  assert.equal(deriveCandidatePlaybooks(fewer).length, 0);

  const enough = [
    makeRun({ id: '1', task: 'list workspace files now', usedSkills: ['file-browser'] }),
    makeRun({ id: '2', task: 'list workspace files please', usedSkills: ['file-browser'] }),
    makeRun({ id: '3', task: 'list workspace files quickly', usedSkills: ['file-browser'] })
  ];
  const playbooks = deriveCandidatePlaybooks(enough);
  assert.ok(playbooks.length >= 1);
  assert.ok(playbooks[0].suggestedSkills.includes('file-browser'));
  assert.ok(playbooks[0].support >= 3);
});

test('reconcilePlaybooks merges similar entries', () => {
  const existing = [{
    id: 'a', title: 'workspace files playbook', trigger: 'workspace files list',
    prompt: '', suggestedSkills: ['file-browser'], support: 3, successRate: 1,
    createdAt: '', updatedAt: '', origins: []
  }];
  const candidate = {
    id: 'b', title: 'workspace files extra', trigger: 'workspace files browse',
    prompt: '', suggestedSkills: ['file-browser'], support: 2, successRate: 1,
    createdAt: '', updatedAt: '', origins: []
  };
  const merged = reconcilePlaybooks(existing, [candidate]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].support, 5);
});

test('selectPlaybook returns the best matching playbook for a task', () => {
  const playbooks = [
    {
      id: 'a', title: 'workspace files', trigger: 'workspace files list',
      prompt: '', suggestedSkills: ['file-browser'], support: 5, successRate: 1,
      createdAt: '', updatedAt: '', origins: []
    },
    {
      id: 'b', title: 'unrelated', trigger: 'fetch website page',
      prompt: '', suggestedSkills: ['web-fetch'], support: 5, successRate: 1,
      createdAt: '', updatedAt: '', origins: []
    }
  ];
  const matched = selectPlaybook(playbooks, 'list workspace files now');
  assert.ok(matched);
  assert.equal(matched.id, 'a');
});

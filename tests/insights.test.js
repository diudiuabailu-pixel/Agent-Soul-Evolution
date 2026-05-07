import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCandidateInsights,
  reconcileInsights,
  selectApplicableInsights
} from '../dist/runtime/insights.js';

function makeRun(overrides) {
  return {
    id: overrides.id || 'r',
    task: overrides.task || 'do work',
    output: overrides.output || '',
    status: overrides.status || 'completed',
    usedSkills: overrides.usedSkills || [],
    reflection: overrides.reflection || '',
    attempts: 1,
    reflectionDetail: overrides.reflectionDetail
  };
}

test('deriveCandidateInsights produces success pattern from repeated wins', () => {
  const runs = [
    makeRun({ id: '1', usedSkills: ['file-browser'], reflectionDetail: { success: true } }),
    makeRun({ id: '2', usedSkills: ['file-browser'], reflectionDetail: { success: true } }),
    makeRun({ id: '3', usedSkills: ['file-browser'], reflectionDetail: { success: true } })
  ];
  const candidates = deriveCandidateInsights(runs);
  assert.ok(candidates.length >= 1);
  const successInsight = candidates.find((insight) => insight.tags.includes('success-pattern'));
  assert.ok(successInsight, 'expected at least one success-pattern insight');
});

test('deriveCandidateInsights surfaces failure families', () => {
  const failureRuns = [
    makeRun({ id: '1', output: 'no url was present in the task', usedSkills: ['web-fetch'], reflectionDetail: { success: false } }),
    makeRun({ id: '2', output: 'no url was present in the task again', usedSkills: ['web-fetch'], reflectionDetail: { success: false } })
  ];
  const candidates = deriveCandidateInsights(failureRuns);
  assert.ok(candidates.some((insight) => insight.tags.includes('failure-pattern')));
});

test('reconcileInsights upvotes a similar existing insight rather than duplicating', () => {
  const existing = [{
    id: 'e1',
    content: 'Successful runs disproportionately route through file-browser, shell-command; prefer this skill order for similar tasks before falling back.',
    support: 3,
    confidence: 0.6,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origins: ['x'],
    tags: ['success-pattern']
  }];
  const candidate = {
    id: 'c1',
    content: 'Successful runs disproportionately route through file-browser, shell-command; prefer this skill order for similar tasks before falling back.',
    support: 2,
    confidence: 0.5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origins: ['y'],
    tags: ['success-pattern']
  };
  const { next, ops } = reconcileInsights(existing, [candidate]);
  assert.equal(next.length, 1);
  assert.equal(next[0].support, 5);
  assert.ok(ops.some((op) => op.kind === 'upvote'));
});

test('selectApplicableInsights ranks by token overlap', () => {
  const insights = [
    {
      id: 'a',
      content: 'workspace file browser pattern',
      support: 1,
      confidence: 0.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origins: [],
      tags: []
    },
    {
      id: 'b',
      content: 'unrelated rule about web fetching',
      support: 1,
      confidence: 0.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origins: [],
      tags: []
    }
  ];
  const selected = selectApplicableInsights(insights, 'list workspace files', 1);
  assert.equal(selected[0].id, 'a');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRunToSoul,
  emptySoul,
  recordEvolution,
  refreshIdentity,
  summarizeSoul
} from '../dist/runtime/soul.js';

const agent = {
  id: 'a',
  name: 'Default Agent',
  goal: 'Test goal',
  systemPrompt: 'sys',
  preferredSkills: [],
  outputStyle: 'short'
};

function makeRun(overrides) {
  return {
    id: overrides.id || 'r',
    task: overrides.task || 'task',
    agent: 'a',
    createdAt: new Date().toISOString(),
    status: overrides.status || 'completed',
    output: overrides.output || '',
    reflection: '',
    usedSkills: overrides.usedSkills || [],
    attempts: 1,
    reflectionDetail: overrides.reflectionDetail || { success: overrides.status !== 'failed', observation: '', lesson: '', importance: 5, signals: [] }
  };
}

test('applyRunToSoul increments counts and skill stats', () => {
  let profile = emptySoul();
  profile = applyRunToSoul(profile, makeRun({ usedSkills: ['file-browser'], status: 'completed' }));
  profile = applyRunToSoul(profile, makeRun({ usedSkills: ['shell-command'], status: 'failed' }));
  assert.equal(profile.runs, 2);
  assert.equal(profile.successes, 1);
  assert.equal(profile.failures, 1);
  assert.equal(profile.successRate, 0.5);
  assert.equal(profile.skillStats['file-browser'].used, 1);
  assert.equal(profile.skillStats['file-browser'].succeeded, 1);
  assert.equal(profile.skillStats['shell-command'].used, 1);
  assert.equal(profile.skillStats['shell-command'].succeeded, 0);
});

test('refreshIdentity composes a multi-line narrative', () => {
  let profile = emptySoul();
  profile = applyRunToSoul(profile, makeRun({ usedSkills: ['file-browser'], status: 'completed' }));
  const refreshed = refreshIdentity(profile, agent, [{
    id: 'i', content: 'Workspace lessons matter.', support: 3, confidence: 0.8,
    createdAt: '', updatedAt: '', origins: [], tags: []
  }]);
  assert.match(refreshed.identity, /Default Agent pursues/);
  assert.match(refreshed.identity, /file-browser/);
  assert.match(refreshed.identity, /Workspace lessons matter/);
});

test('recordEvolution increments generations', () => {
  let profile = emptySoul();
  profile = recordEvolution(profile);
  profile = recordEvolution(profile);
  assert.equal(profile.generations, 2);
  assert.ok(profile.lastEvolvedAt);
});

test('summarizeSoul renders a single-line status', () => {
  let profile = emptySoul();
  profile = applyRunToSoul(profile, makeRun({ usedSkills: ['file-browser'], status: 'completed' }));
  const summary = summarizeSoul(profile);
  assert.match(summary, /runs=1/);
  assert.match(summary, /success=100\.0%/);
});

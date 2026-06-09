import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetryFeedback, evaluateOutcome, summarizeReflection } from '../dist/runtime/reflection.js';

test('evaluateOutcome marks clean output as success', () => {
  const result = evaluateOutcome({
    task: 'List files',
    output: 'Workspace entries:\n- README.md\n- src',
    usedSkills: ['file-browser'],
    status: 'completed'
  });
  assert.equal(result.success, true);
  assert.ok(result.lesson.length > 0);
  assert.ok(result.importance >= 1 && result.importance <= 10);
});

test('evaluateOutcome flags allowlist refusal as failure', () => {
  const result = evaluateOutcome({
    task: 'Run rm -rf /',
    output: 'The command `rm` is not in the safe allowlist.',
    usedSkills: ['shell-command'],
    status: 'completed'
  });
  assert.equal(result.success, false);
  assert.ok(result.signals.includes('not in the safe allowlist'));
});

test('evaluateOutcome flags missing URL on web-fetch', () => {
  const result = evaluateOutcome({
    task: 'Fetch the docs page',
    output: 'No URL was present in the task, so no web content was fetched.',
    usedSkills: ['web-fetch'],
    status: 'completed'
  });
  assert.equal(result.success, false);
  assert.ok(result.signals.includes('no url was present'));
});

test('summarizeReflection includes lesson and snapshot', () => {
  const reflection = {
    success: true,
    observation: 'looks good',
    lesson: 'Prefer file-browser for workspace summaries.',
    importance: 5,
    signals: ['workspace entries:']
  };
  const text = summarizeReflection(reflection, {
    task: 'List files',
    output: 'Workspace entries:\n- README.md',
    usedSkills: ['file-browser']
  });
  assert.match(text, /completed/);
  assert.match(text, /file-browser/);
  assert.match(text, /Prefer file-browser/);
});

test('buildRetryFeedback surfaces lesson and skill context', () => {
  const reflection = {
    success: false,
    observation: '',
    lesson: 'Add a backticked command before invoking shell-command.',
    importance: 6,
    signals: ['no inline shell command']
  };
  const text = buildRetryFeedback(reflection, {
    task: 'Run pwd',
    output: 'To execute a shell command, include it in backticks.',
    usedSkills: ['shell-command']
  });
  assert.match(text, /Previous attempt/);
  assert.match(text, /shell-command/);
  assert.match(text, /backticked/);
});

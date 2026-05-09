import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMemoryOps, summarizeOps } from '../dist/runtime/memory-tools.js';

test('parseMemoryOps extracts a store directive and removes the marker', () => {
  const text = 'Hello.\n<memory:store kind="lesson" importance="8" tags="workspace,files">Pick file-browser first.</memory:store>\nThanks.';
  const result = parseMemoryOps(text);
  assert.equal(result.ops.length, 1);
  assert.equal(result.ops[0].kind, 'store');
  assert.equal(result.ops[0].memoryKind, 'lesson');
  assert.equal(result.ops[0].importance, 8);
  assert.deepEqual(result.ops[0].tags, ['workspace', 'files']);
  assert.equal(result.ops[0].content, 'Pick file-browser first.');
  assert.ok(!result.cleaned.includes('<memory:store'));
  assert.ok(result.cleaned.includes('Hello.'));
});

test('parseMemoryOps handles boost / discard / merge / retrieve', () => {
  const text = [
    '<memory:retrieve k="3">workspace inspection</memory:retrieve>',
    '<memory:boost id="abc" delta="2"/>',
    '<memory:discard id="xyz"/>',
    '<memory:merge>id1, id2 ,id3</memory:merge>'
  ].join('\n');
  const result = parseMemoryOps(text);
  const kinds = result.ops.map((op) => op.kind);
  assert.deepEqual(kinds, ['retrieve', 'boost', 'discard', 'merge']);
  const retrieve = result.ops[0];
  assert.equal(retrieve.kind, 'retrieve');
  assert.equal(retrieve.k, 3);
  const boost = result.ops[1];
  assert.equal(boost.kind, 'boost');
  assert.equal(boost.id, 'abc');
  assert.equal(boost.delta, 2);
  const merge = result.ops[3];
  assert.equal(merge.kind, 'merge');
  assert.deepEqual(merge.ids, ['id1', 'id2', 'id3']);
  assert.equal(result.cleaned.trim(), '');
});

test('parseMemoryOps clamps invalid importance and skips empty merge', () => {
  const text = [
    '<memory:store kind="lesson" importance="99">x</memory:store>',
    '<memory:merge>only-one</memory:merge>'
  ].join('\n');
  const result = parseMemoryOps(text);
  assert.equal(result.ops.length, 1);
  assert.equal(result.ops[0].kind, 'store');
  assert.equal(result.ops[0].importance, 10);
});

test('summarizeOps produces a one-line digest', () => {
  const summary = summarizeOps([
    { kind: 'store', memoryKind: 'lesson', content: 'rule', importance: 7, tags: [] },
    { kind: 'boost', id: 'abc', delta: 1 }
  ]);
  assert.match(summary, /store/);
  assert.match(summary, /boost/);
});

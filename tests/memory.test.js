import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consolidateMemory,
  cosineSimilarity,
  estimateImportance,
  jaccard,
  normalizeImportance,
  recencyScore,
  relevanceScore,
  retrieveMemories,
  tokenSet,
  tokenize
} from '../dist/runtime/memory.js';

const baseConfig = {
  evolution: {
    recencyHalfLifeHours: 168,
    weightRecency: 1,
    weightImportance: 1,
    weightRelevance: 1
  }
};

function makeMemory(overrides) {
  const createdAt = overrides.createdAt || new Date().toISOString();
  return {
    id: overrides.id || 'mem',
    createdAt,
    kind: overrides.kind || 'lesson',
    task: overrides.task || '',
    content: overrides.content || '',
    tags: overrides.tags || [],
    importance: overrides.importance ?? 5,
    accessCount: overrides.accessCount ?? 0,
    lastAccessedAt: overrides.lastAccessedAt || createdAt,
    embedding: overrides.embedding
  };
}

test('tokenize drops stopwords and short tokens', () => {
  const tokens = tokenize('The quick brown fox is jumping over a lazy dog');
  assert.ok(tokens.includes('quick'));
  assert.ok(tokens.includes('brown'));
  assert.ok(tokens.includes('jumping'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('is'));
  assert.ok(!tokens.includes('a'));
});

test('jaccard returns 0 for disjoint sets and 1 for identical', () => {
  assert.equal(jaccard(tokenSet('alpha beta'), tokenSet('gamma delta')), 0);
  assert.equal(jaccard(tokenSet('alpha beta'), tokenSet('alpha beta')), 1);
});

test('recencyScore decays exponentially with half-life', () => {
  const now = new Date('2026-05-07T00:00:00Z');
  const fresh = recencyScore(now.toISOString(), now, 168);
  const aged = recencyScore(new Date(now.getTime() - 168 * 3_600_000).toISOString(), now, 168);
  assert.ok(fresh > 0.99);
  assert.ok(Math.abs(aged - 0.5) < 1e-9);
});

test('normalizeImportance maps 1..10 to 0..1', () => {
  assert.equal(normalizeImportance(1), 0);
  assert.equal(normalizeImportance(10), 1);
  assert.ok(Math.abs(normalizeImportance(5.5) - 0.5) < 1e-9);
  assert.equal(normalizeImportance(20), 1);
});

test('cosineSimilarity handles zero / mismatched vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 1]) - 1) < 1e-9);
  assert.equal(cosineSimilarity(undefined, [1, 1]), 0);
  assert.equal(cosineSimilarity([1, 1], [1, 1, 1]), 0);
});

test('relevanceScore prefers embedding when both available', () => {
  const itemTokens = tokenSet('alpha beta gamma');
  const queryTokens = tokenSet('completely different terms here');
  const tokenOnly = relevanceScore(itemTokens, queryTokens, undefined, undefined);
  const withMatchingEmbedding = relevanceScore(itemTokens, queryTokens, [1, 0], [1, 0]);
  assert.equal(tokenOnly, 0);
  assert.ok(withMatchingEmbedding > 0.6);
});

test('retrieveMemories ranks higher importance/relevance ahead', () => {
  const now = new Date('2026-05-07T00:00:00Z');
  const memories = [
    makeMemory({ id: 'a', content: 'workspace files browser', importance: 8, createdAt: now.toISOString() }),
    makeMemory({ id: 'b', content: 'unrelated content here', importance: 2, createdAt: now.toISOString() })
  ];
  const top = retrieveMemories(memories, 'workspace files', 2, baseConfig, now);
  assert.equal(top[0].item.id, 'a');
  assert.ok(top[0].score > top[1].score);
});

test('estimateImportance bumps insights and failure markers', () => {
  const baseline = estimateImportance('a short note', 'short task', 'result');
  const insight = estimateImportance('a short note', 'short task', 'insight');
  const failure = estimateImportance('an error: execution failed and was denied', 'task with error', 'lesson');
  assert.ok(insight > baseline);
  assert.ok(failure > baseline);
  assert.ok(failure <= 10);
});

test('consolidateMemory merges highly similar items of same kind', () => {
  const now = new Date().toISOString();
  const items = [
    makeMemory({ id: 'a', kind: 'lesson', content: 'workspace files lesson important pattern', importance: 4, createdAt: now }),
    makeMemory({ id: 'b', kind: 'lesson', content: 'workspace files lesson important pattern duplicate', importance: 5, createdAt: now }),
    makeMemory({ id: 'c', kind: 'result', content: 'completely different result content text', importance: 3, createdAt: now })
  ];
  const result = consolidateMemory(items);
  assert.equal(result.merged, 1);
  assert.equal(result.items.length, 2);
  const survivor = result.items.find((item) => item.kind === 'lesson');
  assert.ok(survivor.importance >= 5);
});

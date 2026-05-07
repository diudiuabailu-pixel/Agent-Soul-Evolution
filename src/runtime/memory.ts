import type { MemoryItem, RuntimeConfig } from '../types.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'with', 'of', 'in', 'on',
  'at', 'to', 'for', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do',
  'does', 'did', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'by',
  'from', 'into', 'so', 'such', 'than', 'about', 'over', 'under', 'up', 'down',
  'i', 'you', 'we', 'they', 'he', 'she', 'them', 'us', 'me', 'my', 'your', 'our'
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function recencyScore(createdAt: string, now: Date, halfLifeHours: number): number {
  const created = new Date(createdAt).getTime();
  const ageHours = Math.max(0, (now.getTime() - created) / 3_600_000);
  const halfLife = Math.max(0.1, halfLifeHours);
  return Math.pow(0.5, ageHours / halfLife);
}

export function normalizeImportance(value: number): number {
  const clamped = Math.max(1, Math.min(10, value));
  return (clamped - 1) / 9;
}

export type ScoredMemory = {
  item: MemoryItem;
  score: number;
  components: {
    recency: number;
    importance: number;
    relevance: number;
  };
};

export function scoreMemory(
  item: MemoryItem,
  queryTokens: Set<string>,
  now: Date,
  config: RuntimeConfig
): ScoredMemory {
  const recency = recencyScore(item.lastAccessedAt || item.createdAt, now, config.evolution.recencyHalfLifeHours);
  const importance = normalizeImportance(item.importance);
  const relevance = jaccard(queryTokens, tokenSet(`${item.task} ${item.content}`));
  const score =
    config.evolution.weightRecency * recency +
    config.evolution.weightImportance * importance +
    config.evolution.weightRelevance * relevance;
  return { item, score, components: { recency, importance, relevance } };
}

export function retrieveMemories(
  items: MemoryItem[],
  query: string,
  k: number,
  config: RuntimeConfig,
  now: Date = new Date()
): ScoredMemory[] {
  const queryTokens = tokenSet(query);
  return items
    .map((item) => scoreMemory(item, queryTokens, now, config))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
}

export function estimateImportance(content: string, task: string, kind: string): number {
  const lower = content.toLowerCase();
  let score = 3;

  if (content.length > 240) score += 1;
  if (content.length > 800) score += 1;

  const positive = ['success', 'completed', 'fixed', 'discovered', 'learned', 'pattern', 'rule'];
  const negative = ['error', 'failed', 'blocked', 'denied', 'timeout', 'invalid', 'unable'];
  if (positive.some((token) => lower.includes(token))) score += 1;
  if (negative.some((token) => lower.includes(token))) score += 2;

  if (kind === 'insight') score += 2;
  if (kind === 'lesson') score += 1;

  const taskTokens = tokenSet(task);
  const contentTokens = tokenSet(content);
  const overlap = jaccard(taskTokens, contentTokens);
  if (overlap > 0.4) score += 1;

  return Math.max(1, Math.min(10, Math.round(score)));
}

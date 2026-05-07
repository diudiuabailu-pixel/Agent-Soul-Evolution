import { nanoid } from 'nanoid';
import type { Insight, RunRecord } from '../types.js';
import { jaccard, tokenSet } from './memory.js';

const INSIGHT_SIMILARITY_THRESHOLD = 0.55;

export type InsightOperation =
  | { kind: 'add'; insight: Insight }
  | { kind: 'upvote'; id: string }
  | { kind: 'downvote'; id: string }
  | { kind: 'edit'; id: string; nextContent: string };

function nowIso(): string {
  return new Date().toISOString();
}

function topTags(runs: RunRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const skill of run.usedSkills) {
      counts.set(skill, (counts.get(skill) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
}

function summarizeFailureFamilies(failures: RunRecord[]): Array<{ pattern: string; runs: RunRecord[] }> {
  const families: Array<{ pattern: string; runs: RunRecord[] }> = [];
  const patterns: Array<[RegExp, string]> = [
    [/not in the safe allowlist/i, 'shell allowlist refusal'],
    [/no url was present/i, 'missing URL for web-fetch'],
    [/no inline shell command/i, 'missing backticked shell command'],
    [/execution failed/i, 'skill execution error'],
    [/no skill output/i, 'no skill output produced']
  ];
  for (const [pattern, label] of patterns) {
    const matched = failures.filter((run) => pattern.test(run.output));
    if (matched.length > 0) families.push({ pattern: label, runs: matched });
  }
  return families;
}

function craftSuccessInsight(successes: RunRecord[]): Insight | null {
  if (successes.length < 2) return null;
  const skills = topTags(successes);
  if (skills.length === 0) {
    return {
      id: nanoid(),
      content: 'Direct, skill-free responses succeed when the request is short and self-contained; restate the user goal before answering.',
      support: successes.length,
      confidence: Math.min(1, successes.length / 5),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      origins: successes.slice(0, 3).map((run) => run.id),
      tags: ['success-pattern', 'no-skill']
    };
  }
  return {
    id: nanoid(),
    content: `Successful runs disproportionately route through ${skills.join(', ')}; prefer this skill order for similar tasks before falling back.`,
    support: successes.length,
    confidence: Math.min(1, successes.length / 5),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    origins: successes.slice(0, 3).map((run) => run.id),
    tags: ['success-pattern', ...skills]
  };
}

function craftFailureInsights(failures: RunRecord[]): Insight[] {
  const families = summarizeFailureFamilies(failures);
  return families.map((family) => ({
    id: nanoid(),
    content: `Recurring failure: ${family.pattern}. Mitigate by validating preconditions before invoking the related skill (${family.runs.length} occurrences).`,
    support: family.runs.length,
    confidence: Math.min(1, family.runs.length / 4),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    origins: family.runs.slice(0, 3).map((run) => run.id),
    tags: ['failure-pattern', family.pattern]
  }));
}

function findSimilar(existing: Insight[], candidate: Insight): Insight | null {
  const candidateTokens = tokenSet(candidate.content);
  let best: { insight: Insight; score: number } | null = null;
  for (const insight of existing) {
    const score = jaccard(candidateTokens, tokenSet(insight.content));
    if (score >= INSIGHT_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { insight, score };
    }
  }
  return best ? best.insight : null;
}

export function deriveCandidateInsights(runs: RunRecord[]): Insight[] {
  if (runs.length === 0) return [];
  const successes = runs.filter((run) => run.reflectionDetail?.success ?? run.status === 'completed');
  const failures = runs.filter((run) => !(run.reflectionDetail?.success ?? false) && run.status === 'completed');
  const candidates: Insight[] = [];
  const successInsight = craftSuccessInsight(successes);
  if (successInsight) candidates.push(successInsight);
  candidates.push(...craftFailureInsights(failures));
  return candidates;
}

export function reconcileInsights(existing: Insight[], candidates: Insight[]): { next: Insight[]; ops: InsightOperation[] } {
  const next = existing.map((insight) => ({ ...insight }));
  const ops: InsightOperation[] = [];

  for (const candidate of candidates) {
    const similar = findSimilar(next, candidate);
    if (similar) {
      const target = next.find((item) => item.id === similar.id);
      if (!target) continue;
      target.support += candidate.support;
      target.confidence = Math.min(1, target.confidence + 0.1);
      target.updatedAt = nowIso();
      target.origins = Array.from(new Set([...target.origins, ...candidate.origins])).slice(0, 8);
      ops.push({ kind: 'upvote', id: target.id });
    } else {
      next.push(candidate);
      ops.push({ kind: 'add', insight: candidate });
    }
  }

  for (const insight of next) {
    const ageDays = (Date.now() - new Date(insight.updatedAt).getTime()) / 86_400_000;
    if (ageDays > 14 && insight.support < 2) {
      insight.confidence = Math.max(0, insight.confidence - 0.1);
      ops.push({ kind: 'downvote', id: insight.id });
    }
  }

  next.sort((a, b) => b.support * b.confidence - a.support * a.confidence);
  return { next: next.slice(0, 50), ops };
}

export function selectApplicableInsights(insights: Insight[], task: string, k: number): Insight[] {
  const taskTokens = tokenSet(task);
  return insights
    .map((insight) => ({ insight, score: jaccard(taskTokens, tokenSet(insight.content)) + insight.confidence * 0.2 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((entry) => entry.score > 0)
    .map((entry) => entry.insight);
}

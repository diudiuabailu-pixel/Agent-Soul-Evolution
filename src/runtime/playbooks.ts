import { nanoid } from 'nanoid';
import type { Playbook, RunRecord } from '../types.js';
import { jaccard, tokenSet, tokenize } from './memory.js';

const MIN_OCCURRENCES = 3;
const SIMILARITY_THRESHOLD = 0.45;
const MAX_PLAYBOOKS = 25;

function nowIso(): string {
  return new Date().toISOString();
}

function isSuccess(run: RunRecord): boolean {
  if (run.reflectionDetail) return run.reflectionDetail.success;
  return run.status === 'completed';
}

function clusterRuns(runs: RunRecord[]): RunRecord[][] {
  const clusters: RunRecord[][] = [];
  for (const run of runs) {
    const tokens = tokenSet(run.task);
    let placed = false;
    for (const cluster of clusters) {
      const seedTokens = tokenSet(cluster[0].task);
      if (jaccard(tokens, seedTokens) >= SIMILARITY_THRESHOLD) {
        cluster.push(run);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([run]);
  }
  return clusters.filter((cluster) => cluster.length >= MIN_OCCURRENCES);
}

function topSkills(cluster: RunRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const run of cluster) {
    for (const skill of run.usedSkills) counts.set(skill, (counts.get(skill) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
}

function commonTokens(cluster: RunRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const run of cluster) {
    for (const token of new Set(tokenize(run.task))) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.floor(cluster.length / 2));
  return Array.from(counts.entries())
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token);
}

function craftPlaybook(cluster: RunRecord[]): Playbook {
  const successes = cluster.filter(isSuccess).length;
  const successRate = successes / cluster.length;
  const skills = topSkills(cluster);
  const trigger = commonTokens(cluster).join(' ');
  const sample = cluster[0].task;
  return {
    id: nanoid(),
    title: `Playbook for "${sample.slice(0, 60)}"`,
    trigger,
    prompt: [
      `Tasks similar to: ${sample}`,
      `Common keywords: ${trigger || 'none'}`,
      skills.length > 0
        ? `Preferred skill order: ${skills.join(', ')}.`
        : 'Skill-free direct response often works for this pattern.',
      `Historical success: ${(successRate * 100).toFixed(0)}% across ${cluster.length} runs.`,
      'Plan: confirm the user goal, route through the preferred skill order if applicable, and answer with a tight grounded summary.'
    ].join('\n'),
    suggestedSkills: skills,
    support: cluster.length,
    successRate,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    origins: cluster.slice(0, 4).map((run) => run.id)
  };
}

export function deriveCandidatePlaybooks(runs: RunRecord[]): Playbook[] {
  const successes = runs.filter(isSuccess);
  if (successes.length < MIN_OCCURRENCES) return [];
  const clusters = clusterRuns(successes);
  return clusters
    .map(craftPlaybook)
    .filter((playbook) => playbook.successRate >= 0.6)
    .slice(0, 8);
}

export function reconcilePlaybooks(existing: Playbook[], candidates: Playbook[]): Playbook[] {
  const next = existing.map((entry) => ({ ...entry }));
  for (const candidate of candidates) {
    const candidateTokens = tokenSet(candidate.trigger || candidate.title);
    const match = next.find((entry) => jaccard(tokenSet(entry.trigger || entry.title), candidateTokens) >= 0.4);
    if (match) {
      match.support += candidate.support;
      match.successRate = ((match.successRate * match.support) + (candidate.successRate * candidate.support)) / (match.support + candidate.support || 1);
      match.updatedAt = nowIso();
      match.suggestedSkills = Array.from(new Set([...match.suggestedSkills, ...candidate.suggestedSkills])).slice(0, 4);
      match.origins = Array.from(new Set([...match.origins, ...candidate.origins])).slice(0, 8);
    } else {
      next.push(candidate);
    }
  }
  next.sort((a, b) => (b.support * b.successRate) - (a.support * a.successRate));
  return next.slice(0, MAX_PLAYBOOKS);
}

export function selectPlaybook(playbooks: Playbook[], task: string): Playbook | null {
  if (playbooks.length === 0) return null;
  const taskTokens = tokenSet(task);
  let best: { entry: Playbook; score: number } | null = null;
  for (const entry of playbooks) {
    const triggerScore = jaccard(taskTokens, tokenSet(entry.trigger || entry.title));
    const score = triggerScore * 0.7 + entry.successRate * 0.3;
    if (score < 0.1) continue;
    if (!best || score > best.score) best = { entry, score };
  }
  return best ? best.entry : null;
}

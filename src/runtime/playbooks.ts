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
  const lookup = new Map(playbooks.map((entry) => [entry.id, entry]));
  function score(entry: Playbook): number {
    const triggerScore = jaccard(taskTokens, tokenSet(entry.trigger || entry.title));
    return triggerScore * 0.7 + entry.successRate * 0.3;
  }
  function descend(entry: Playbook, currentScore: number): { entry: Playbook; score: number } {
    const children = (entry.childIds ?? []).map((id) => lookup.get(id)).filter((child): child is Playbook => Boolean(child));
    let best = { entry, score: currentScore };
    for (const child of children) {
      const childScore = score(child);
      if (childScore > best.score) best = descend(child, childScore);
    }
    return best;
  }
  let bestOverall: { entry: Playbook; score: number } | null = null;
  for (const root of playbooks.filter((entry) => !entry.parentId)) {
    const rootScore = score(root);
    if (rootScore < 0.1) continue;
    const candidate = descend(root, rootScore);
    if (!bestOverall || candidate.score > bestOverall.score) bestOverall = candidate;
  }
  if (!bestOverall) {
    for (const entry of playbooks) {
      const entryScore = score(entry);
      if (entryScore < 0.1) continue;
      if (!bestOverall || entryScore > bestOverall.score) bestOverall = { entry, score: entryScore };
    }
  }
  return bestOverall ? bestOverall.entry : null;
}

export type PlaybookOp =
  | { kind: 'fixed'; id: string; reason: string }
  | { kind: 'derived'; parents: string[]; child: Playbook }
  | { kind: 'pruned'; id: string; reason: string };

export type PlaybookCycleResult = {
  next: Playbook[];
  ops: PlaybookOp[];
};

const FIX_THRESHOLD = 0.4;
const DERIVE_OVERLAP = 0.5;

function rebuildSuccessRate(playbook: Playbook, runs: RunRecord[]): number {
  const recent = runs.filter((run) => playbook.origins.includes(run.id));
  if (recent.length === 0) return playbook.successRate;
  const successes = recent.filter((run) => run.reflectionDetail?.success ?? run.status === 'completed').length;
  return successes / recent.length;
}

export function evolvePlaybooks(existing: Playbook[], recentRuns: RunRecord[]): PlaybookCycleResult {
  const next = existing.map((entry) => ({ ...entry }));
  const ops: PlaybookOp[] = [];

  for (const playbook of next) {
    if (playbook.support < 3) continue;
    const observed = rebuildSuccessRate(playbook, recentRuns);
    if (observed < FIX_THRESHOLD && observed < playbook.successRate) {
      const previous = playbook.prompt;
      const reason = `success rate fell from ${(playbook.successRate * 100).toFixed(0)}% to ${(observed * 100).toFixed(0)}%`;
      playbook.prompt = `${previous}\nFIX: recent runs show this playbook is no longer reliable; verify preconditions before applying.`;
      playbook.successRate = observed;
      playbook.updatedAt = new Date().toISOString();
      ops.push({ kind: 'fixed', id: playbook.id, reason });
    }
  }

  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i];
      const b = next[j];
      if (a.suggestedSkills.length === 0 || b.suggestedSkills.length === 0) continue;
      const aTokens = tokenSet(a.trigger || a.title);
      const bTokens = tokenSet(b.trigger || b.title);
      const overlap = jaccard(aTokens, bTokens);
      if (overlap < DERIVE_OVERLAP) continue;
      const skillsOverlap = a.suggestedSkills.filter((skill) => b.suggestedSkills.includes(skill));
      if (skillsOverlap.length === 0) continue;
      const combinedTriggers = Array.from(new Set([...aTokens, ...bTokens])).join(' ');
      const child: Playbook = {
        id: nanoid(),
        title: `Derived playbook for "${(a.title.replace(/^Playbook for /, '') + ' / ' + b.title.replace(/^Playbook for /, '')).slice(0, 70)}"`,
        trigger: combinedTriggers.split(/\s+/).slice(0, 6).join(' '),
        prompt: `Derived from "${a.title}" and "${b.title}".\nUse skills in order: ${skillsOverlap.join(', ')}.\nApply when the task overlaps the union of triggers.`,
        suggestedSkills: skillsOverlap,
        support: a.support + b.support,
        successRate: (a.successRate + b.successRate) / 2,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        origins: Array.from(new Set([...a.origins, ...b.origins])).slice(0, 6),
        childIds: [a.id, b.id]
      };
      a.parentId = child.id;
      b.parentId = child.id;
      const alreadyDerived = next.some((entry) => entry.title === child.title);
      if (!alreadyDerived) {
        next.push(child);
        ops.push({ kind: 'derived', parents: [a.id, b.id], child });
        return { next, ops };
      }
    }
  }

  return { next, ops };
}

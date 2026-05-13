import type { AgentProfile, Insight, RunRecord, SoulProfile } from '../types.js';

const EMPTY_SOUL: SoulProfile = {
  runs: 0,
  successes: 0,
  failures: 0,
  successRate: 0,
  generations: 0,
  identity: '',
  skillStats: {},
  lastEvolvedAt: null,
  updatedAt: new Date(0).toISOString(),
  firstAttemptSuccesses: 0,
  retryAttempts: 0,
  retrySuccesses: 0,
  retryUplift: 0,
  lifetimeTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  lifetimeMs: 0,
  checkerCalibration: {
    samples: 0,
    brierScoreSum: 0,
    averageBrier: 0,
    overconfidentCount: 0,
    underconfidentCount: 0
  }
};

function clone(profile: SoulProfile): SoulProfile {
  return {
    ...profile,
    skillStats: Object.fromEntries(Object.entries(profile.skillStats).map(([key, value]) => [key, { ...value }])),
    lifetimeTokens: { ...(profile.lifetimeTokens || { promptTokens: 0, completionTokens: 0, totalTokens: 0 }) },
    checkerCalibration: { ...(profile.checkerCalibration || EMPTY_SOUL.checkerCalibration) }
  };
}

function topSkills(stats: SoulProfile['skillStats'], k: number): Array<{ id: string; used: number; succeeded: number; rate: number }> {
  return Object.entries(stats)
    .map(([id, value]) => ({
      id,
      used: value.used,
      succeeded: value.succeeded,
      rate: value.used > 0 ? value.succeeded / value.used : 0
    }))
    .sort((a, b) => b.used - a.used)
    .slice(0, k);
}

function composeIdentity(agent: AgentProfile, profile: SoulProfile, insights: Insight[]): string {
  const top = topSkills(profile.skillStats, 3);
  const skillSummary = top.length > 0
    ? top.map((entry) => `${entry.id} (${entry.succeeded}/${entry.used})`).join(', ')
    : 'no skills exercised yet';
  const insightSummary = insights.length > 0
    ? insights.slice(0, 3).map((insight) => `- ${insight.content}`).join('\n')
    : '- no consolidated insights yet';
  const successPct = (profile.successRate * 100).toFixed(1);
  return [
    `${agent.name} pursues: ${agent.goal}`,
    `Operational stance: ${agent.outputStyle}`,
    `Lifetime: ${profile.runs} runs, ${successPct}% clean success across ${profile.generations} evolution cycle(s).`,
    `Most exercised skills: ${skillSummary}.`,
    `Top insights:\n${insightSummary}`
  ].join('\n');
}

export function emptySoul(): SoulProfile {
  return clone(EMPTY_SOUL);
}

export function applyRunToSoul(profile: SoulProfile, run: RunRecord): SoulProfile {
  const next = clone(profile);
  next.runs += 1;
  const success = run.reflectionDetail?.success ?? run.status === 'completed';
  if (success) next.successes += 1;
  else next.failures += 1;
  next.successRate = next.runs > 0 ? next.successes / next.runs : 0;

  const attempts = typeof run.attempts === 'number' ? run.attempts : 1;
  const firstAttempt = run.firstAttemptSucceeded ?? (attempts === 1 && success);
  if (firstAttempt) {
    next.firstAttemptSuccesses += 1;
  } else if (attempts > 1) {
    next.retryAttempts += 1;
    if (success) next.retrySuccesses += 1;
  }
  next.retryUplift = next.retryAttempts > 0 ? next.retrySuccesses / next.retryAttempts : 0;

  if (run.tokenUsage) {
    next.lifetimeTokens.promptTokens += run.tokenUsage.promptTokens;
    next.lifetimeTokens.completionTokens += run.tokenUsage.completionTokens;
    next.lifetimeTokens.totalTokens += run.tokenUsage.totalTokens;
  }
  if (typeof run.durationMs === 'number') {
    next.lifetimeMs += run.durationMs;
  }

  if (run.checkerVerdict) {
    const predicted = run.checkerVerdict.satisfied ? run.checkerVerdict.confidence : 1 - run.checkerVerdict.confidence;
    const actual = success ? 1 : 0;
    const brier = (predicted - actual) ** 2;
    next.checkerCalibration.samples += 1;
    next.checkerCalibration.brierScoreSum += brier;
    next.checkerCalibration.averageBrier = next.checkerCalibration.brierScoreSum / next.checkerCalibration.samples;
    if (run.checkerVerdict.satisfied && !success) next.checkerCalibration.overconfidentCount += 1;
    if (!run.checkerVerdict.satisfied && success) next.checkerCalibration.underconfidentCount += 1;
  }

  for (const skill of run.usedSkills) {
    const entry = next.skillStats[skill] || { used: 0, succeeded: 0 };
    entry.used += 1;
    if (success) entry.succeeded += 1;
    next.skillStats[skill] = entry;
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

export function refreshIdentity(profile: SoulProfile, agent: AgentProfile, insights: Insight[]): SoulProfile {
  const next = clone(profile);
  next.identity = composeIdentity(agent, next, insights);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function recordEvolution(profile: SoulProfile): SoulProfile {
  const next = clone(profile);
  next.generations += 1;
  next.lastEvolvedAt = new Date().toISOString();
  next.updatedAt = next.lastEvolvedAt;
  return next;
}

export function summarizeSoul(profile: SoulProfile): string {
  const successPct = (profile.successRate * 100).toFixed(1);
  const retryPct = profile.retryAttempts > 0 ? `${(profile.retryUplift * 100).toFixed(0)}%` : 'n/a';
  const tokens = profile.lifetimeTokens?.totalTokens ?? 0;
  const brier = profile.checkerCalibration?.samples > 0
    ? ` brier=${profile.checkerCalibration.averageBrier.toFixed(3)}`
    : '';
  const top = topSkills(profile.skillStats, 3)
    .map((entry) => `${entry.id} ${entry.succeeded}/${entry.used}`)
    .join(' | ');
  return `runs=${profile.runs} success=${successPct}% retryUplift=${retryPct} tokens=${tokens}${brier} generations=${profile.generations}${top ? ` | top: ${top}` : ''}`;
}

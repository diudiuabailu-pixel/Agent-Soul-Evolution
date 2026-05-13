import { invokeModel } from './model.js';
import { loadAgent, saveAgent, loadRuns } from './storage.js';
import { runEvalSuite } from './eval.js';
import type { AgentProfile, EvalCase } from '../types.js';

const MAX_CANDIDATES = 3;

export type CandidateProposal = {
  systemPrompt: string;
  outputStyle: string;
  rationale: string;
};

export type PromptEvolutionReport = {
  baselineSuccessRate: number;
  best: { successRate: number; rationale: string; agent: AgentProfile } | null;
  rejected: Array<{ successRate: number; rationale: string }>;
  baselineAgent: AgentProfile;
  improved: boolean;
};

function recentFailureSummary(runs: Array<{ task: string; status: string; reflection: string; reflectionDetail?: { signals?: string[] } }>, k: number): string {
  const failures = runs.filter((run) => run.status === 'failed').slice(0, k);
  if (failures.length === 0) return 'No recent failures recorded.';
  return failures
    .map((run, idx) => `Failure ${idx + 1}: task="${run.task.slice(0, 100)}" signals=${(run.reflectionDetail?.signals ?? []).join(', ')}`)
    .join('\n');
}

function parseCandidates(raw: string): CandidateProposal[] {
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.systemPrompt === 'string')
      .slice(0, MAX_CANDIDATES)
      .map((entry) => ({
        systemPrompt: String(entry.systemPrompt),
        outputStyle: String(entry.outputStyle || ''),
        rationale: String(entry.rationale || '')
      }));
  } catch {
    return [];
  }
}

async function modelProposeCandidates(agent: AgentProfile, failureSummary: string): Promise<CandidateProposal[]> {
  const prompt = [
    'You are an agent prompt optimizer. Propose up to three improved system prompts that would address the recent failures below.',
    'Reply with a JSON array of objects: [{"systemPrompt": "...", "outputStyle": "...", "rationale": "..."}, ...]. JSON only, no prose.',
    'Keep each systemPrompt under 220 words and grounded in the original style.',
    `Current systemPrompt: ${agent.systemPrompt}`,
    `Current outputStyle: ${agent.outputStyle}`,
    `Recent failures:\n${failureSummary}`
  ].join('\n');

  const response = await invokeModel(
    [
      { role: 'system', content: 'You output JSON only.' },
      { role: 'user', content: prompt }
    ],
    { timeoutMs: 20_000 }
  );
  if (!response) return [];
  return parseCandidates(response);
}

function heuristicCandidates(agent: AgentProfile, failureSummary: string): CandidateProposal[] {
  const additions: Array<{ rule: string; rationale: string }> = [];
  const lower = failureSummary.toLowerCase();
  if (lower.includes('not in the safe allowlist')) {
    additions.push({
      rule: 'When asked to run shell commands, only suggest commands inside the safe allowlist (pwd, ls, cat, echo, git).',
      rationale: 'Recent runs failed when proposing disallowed shell commands.'
    });
  }
  if (lower.includes('no url was present')) {
    additions.push({
      rule: 'Only invoke web-fetch when the task contains an explicit http(s) URL; otherwise answer directly.',
      rationale: 'Recent runs invoked web-fetch without a URL in the prompt.'
    });
  }
  if (lower.includes('no inline shell command')) {
    additions.push({
      rule: 'Wrap any shell command you intend to run in backticks so the runner can extract it.',
      rationale: 'Recent runs failed when shell commands were not backticked.'
    });
  }
  if (additions.length === 0) {
    additions.push({
      rule: 'Restate the user goal in one short sentence before answering, then cite the most relevant memory or insight you used.',
      rationale: 'Generic improvement that helps grounding when no specific failure family is detected.'
    });
  }
  return additions.map((entry) => ({
    systemPrompt: `${agent.systemPrompt}\n${entry.rule}`,
    outputStyle: agent.outputStyle,
    rationale: entry.rationale
  }));
}

export async function evolvePromptOnce(extraCases: EvalCase[] = []): Promise<PromptEvolutionReport> {
  const baselineAgent = await loadAgent();
  const baseline = await runEvalSuite(extraCases);
  const baselineSuccessRate = baseline.successRate;

  const recent = await loadRuns();
  const failureSummary = recentFailureSummary(recent, 5);

  const modelCandidates = await modelProposeCandidates(baselineAgent, failureSummary);
  const candidates = modelCandidates.length > 0 ? modelCandidates : heuristicCandidates(baselineAgent, failureSummary);

  let best: PromptEvolutionReport['best'] = null;
  const rejected: PromptEvolutionReport['rejected'] = [];

  for (const candidate of candidates) {
    const trial: AgentProfile = {
      ...baselineAgent,
      systemPrompt: candidate.systemPrompt,
      outputStyle: candidate.outputStyle || baselineAgent.outputStyle
    };
    await saveAgent(trial);
    const result = await runEvalSuite(extraCases);
    if (result.successRate > baselineSuccessRate && (!best || result.successRate > best.successRate)) {
      best = { successRate: result.successRate, rationale: candidate.rationale, agent: trial };
    } else {
      rejected.push({ successRate: result.successRate, rationale: candidate.rationale });
    }
  }

  if (best) {
    await saveAgent(best.agent);
    return { baselineSuccessRate, best, rejected, baselineAgent, improved: true };
  }
  await saveAgent(baselineAgent);
  return { baselineSuccessRate, best: null, rejected, baselineAgent, improved: false };
}

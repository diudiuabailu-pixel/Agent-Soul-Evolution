import {
  appendMemory,
  appendRun,
  loadAgent,
  loadConfig,
  loadInsights,
  loadInstalledSkills,
  loadMemory,
  loadRuns,
  loadSoulProfile,
  saveInsights,
  saveSoulProfile,
  touchMemory
} from './storage.js';
import { buildRetryFeedback, evaluateOutcome, summarizeReflection } from './reflection.js';
import { invokeModel } from './model.js';
import { executeSkill } from './skill-runner.js';
import { defaultWorkflow } from './workflow.js';
import { retrieveMemories } from './memory.js';
import { deriveCandidateInsights, reconcileInsights, selectApplicableInsights } from './insights.js';
import { applyRunToSoul, recordEvolution, refreshIdentity } from './soul.js';
import type { Insight, ReflectionResult, RunRecord, RuntimeConfig, SoulProfile } from '../types.js';

const MEMORY_TOP_K = 5;
const INSIGHT_TOP_K = 3;

function fileApplicable(task: string): boolean {
  return /\b(file|folder|directory|workspace)\b/i.test(task);
}

function webApplicable(task: string): boolean {
  return /https?:\/\/\S+/i.test(task);
}

function shellApplicable(task: string): boolean {
  if (/`[^`]+`/.test(task)) return true;
  return /\b(pwd|ls|cat|echo|git)\b/i.test(task);
}

function chooseSkills(task: string, installed: string[], preferred: string[]): string[] {
  const picks = new Set<string>();
  const applicability: Record<string, (task: string) => boolean> = {
    'file-browser': fileApplicable,
    'web-fetch': webApplicable,
    'shell-command': shellApplicable
  };

  for (const skill of installed) {
    const check = applicability[skill];
    if (check && check(task)) picks.add(skill);
  }

  for (const skill of preferred) {
    if (!installed.includes(skill)) continue;
    const check = applicability[skill];
    if (!check) {
      picks.add(skill);
      continue;
    }
    if (check(task)) picks.add(skill);
  }

  return Array.from(picks);
}

function summarizeRetrievedMemory(memories: ReturnType<typeof retrieveMemories>): string {
  if (memories.length === 0) return 'No relevant memory recalled.';
  return memories
    .map((entry) => `- (${entry.components.recency.toFixed(2)}r ${entry.components.importance.toFixed(2)}i ${entry.components.relevance.toFixed(2)}v) ${entry.item.content.slice(0, 200)}`)
    .join('\n');
}

function summarizeInsights(insights: Insight[]): string {
  if (insights.length === 0) return 'No applicable insights.';
  return insights.map((insight) => `- (s=${insight.support} c=${insight.confidence.toFixed(2)}) ${insight.content}`).join('\n');
}

async function executeAttempt(
  task: string,
  attemptNumber: number,
  retryFeedback: string | null,
  baseContext: { systemPrompt: string; outputStyle: string; agentName: string; agentGoal: string; usedSkills: string[]; memorySummary: string; insightSummary: string; soulSummary: string }
): Promise<{ output: string; skillOutputs: string[] }> {
  const userMessage = [
    `Task: ${task}`,
    `Attempt: ${attemptNumber}`,
    retryFeedback ? `Retry guidance: ${retryFeedback}` : '',
    `Available skills: ${baseContext.usedSkills.join(', ') || 'none'}`,
    `Workflow: ${defaultWorkflow.map((step) => `${step.name}: ${step.description}`).join(' | ')}`,
    `Soul: ${baseContext.soulSummary}`,
    `Recalled memory:\n${baseContext.memorySummary}`,
    `Active insights:\n${baseContext.insightSummary}`
  ].filter(Boolean).join('\n');

  const modelResponse = await invokeModel([
    { role: 'system', content: `${baseContext.systemPrompt}\nOutput style: ${baseContext.outputStyle}` },
    { role: 'user', content: userMessage }
  ]);

  const skillOutputs: string[] = [];
  for (const skillId of baseContext.usedSkills) {
    try {
      const result = await executeSkill(skillId, task);
      skillOutputs.push(`[${result.skillId}] ${result.summary}\n${result.output}`);
    } catch (error) {
      skillOutputs.push(`[${skillId}] Execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const fallbackOutput = [
    `Agent: ${baseContext.agentName}`,
    `Goal: ${baseContext.agentGoal}`,
    `Task: ${task}`,
    `Attempt: ${attemptNumber}`,
    retryFeedback ? `Retry guidance: ${retryFeedback}` : '',
    `Recalled memory:\n${baseContext.memorySummary}`,
    `Active insights:\n${baseContext.insightSummary}`,
    baseContext.usedSkills.length > 0
      ? `Suggested execution path: use ${baseContext.usedSkills.join(', ')}.`
      : 'Suggested execution path: respond directly and request a skill only when needed.',
    skillOutputs.length > 0 ? `Skill output:\n${skillOutputs.join('\n\n')}` : 'No skill output available.',
    'Result: task has been analyzed and prepared for execution in the local runtime.'
  ].filter(Boolean).join('\n');

  return { output: modelResponse || fallbackOutput, skillOutputs };
}

async function maybeEvolve(profile: SoulProfile, config: RuntimeConfig): Promise<{ profile: SoulProfile; insights: Insight[] }> {
  const cadence = Math.max(1, config.evolution.insightCadence);
  if (profile.runs === 0 || profile.runs % cadence !== 0) {
    const insights = await loadInsights();
    return { profile, insights };
  }
  const runs = await loadRuns();
  const recent = runs.slice(0, Math.max(cadence * 2, 6));
  const candidates = deriveCandidateInsights(recent);
  const existing = await loadInsights();
  const { next } = reconcileInsights(existing, candidates);
  await saveInsights(next);
  const evolved = recordEvolution(profile);
  return { profile: evolved, insights: next };
}

export async function runTask(task: string): Promise<RunRecord> {
  const [agent, installedSkills, memory, config, insights, profileRaw] = await Promise.all([
    loadAgent(),
    loadInstalledSkills(),
    loadMemory(),
    loadConfig(),
    loadInsights(),
    loadSoulProfile()
  ]);

  const usedSkills = chooseSkills(task, installedSkills, agent.preferredSkills);
  const retrieved = retrieveMemories(memory, task, MEMORY_TOP_K, config);
  const applicableInsights = selectApplicableInsights(insights, task, INSIGHT_TOP_K);

  const baseContext = {
    systemPrompt: agent.systemPrompt,
    outputStyle: agent.outputStyle,
    agentName: agent.name,
    agentGoal: agent.goal,
    usedSkills,
    memorySummary: summarizeRetrievedMemory(retrieved),
    insightSummary: summarizeInsights(applicableInsights),
    soulSummary: profileRaw.identity || `runs=${profileRaw.runs} success=${(profileRaw.successRate * 100).toFixed(1)}%`
  };

  let attempt = 1;
  let { output, skillOutputs } = await executeAttempt(task, attempt, null, baseContext);
  let reflectionDetail: ReflectionResult = evaluateOutcome({ task, output, usedSkills, status: 'completed' });

  if (!reflectionDetail.success && config.evolution.retryOnFailure && config.evolution.maxRetries > 0) {
    const retryLimit = Math.min(config.evolution.maxRetries, 3);
    while (!reflectionDetail.success && attempt <= retryLimit) {
      attempt += 1;
      const feedback = buildRetryFeedback(reflectionDetail, { task, output, usedSkills });
      const next = await executeAttempt(task, attempt, feedback, baseContext);
      output = next.output;
      skillOutputs = next.skillOutputs;
      reflectionDetail = evaluateOutcome({ task, output, usedSkills, status: 'completed' });
    }
  }

  const status: RunRecord['status'] = reflectionDetail.success ? 'completed' : 'failed';
  const reflection = summarizeReflection(reflectionDetail, { task, output, usedSkills });

  const draftRun: Omit<RunRecord, 'id' | 'createdAt'> = {
    agent: agent.id,
    task,
    output,
    status,
    usedSkills,
    reflection,
    attempts: attempt,
    reflectionDetail,
    retrievedMemoryIds: retrieved.map((entry) => entry.item.id),
    appliedInsightIds: applicableInsights.map((insight) => insight.id)
  };

  const storedRun = await appendRun(draftRun);
  await touchMemory(retrieved.map((entry) => entry.item.id));

  await appendMemory({
    kind: 'result',
    task,
    content: output,
    tags: ['task', 'result', status]
  });

  await appendMemory({
    kind: 'reflection',
    task,
    content: reflection,
    tags: ['task', 'reflection', status]
  });

  await appendMemory({
    kind: 'lesson',
    task,
    content: reflectionDetail.lesson,
    tags: ['task', 'lesson', ...usedSkills],
    importance: reflectionDetail.importance
  });

  let updatedProfile = applyRunToSoul(profileRaw, storedRun);
  const evolution = await maybeEvolve(updatedProfile, config);
  updatedProfile = refreshIdentity(evolution.profile, agent, evolution.insights);
  await saveSoulProfile(updatedProfile);

  return storedRun;
}

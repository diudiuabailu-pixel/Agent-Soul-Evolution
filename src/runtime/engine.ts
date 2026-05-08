import {
  appendMemory,
  appendRun,
  loadAgent,
  loadConfig,
  loadInsights,
  loadInstalledSkills,
  loadMemory,
  loadPlaybooks,
  loadRuns,
  loadSoulProfile,
  saveInsights,
  saveMemoryItems,
  savePlaybooks,
  saveSoulProfile,
  touchMemory,
  updateMemoryEmbedding,
  updateMemoryImportance,
  updateMemoryLinks
} from './storage.js';
import { buildRetryFeedback, evaluateOutcome, summarizeReflection } from './reflection.js';
import { invokeModel } from './model.js';
import { embedWithCache, enqueueEmbeddingJob } from './embedding-cache.js';
import { executeSkill } from './skill-runner.js';
import { defaultWorkflow } from './workflow.js';
import { consolidateMemory, retrieveMemories, topLinkCandidates } from './memory.js';
import { deriveCandidateInsights, reconcileInsights, selectApplicableInsights } from './insights.js';
import { applyRunToSoul, recordEvolution, refreshIdentity } from './soul.js';
import { checkRunOutcome } from './checker.js';
import { scoreImportanceWithModel } from './importance-scorer.js';
import { deriveCandidatePlaybooks, reconcilePlaybooks, selectPlaybook } from './playbooks.js';
import type {
  CheckerVerdict,
  Insight,
  MemoryItem,
  Playbook,
  ReflectionResult,
  RunRecord,
  RuntimeConfig,
  SoulProfile
} from '../types.js';

const MEMORY_TOP_K = 5;
const INSIGHT_TOP_K = 3;
const LINK_FANOUT = 3;

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

function summarizePlaybook(playbook: Playbook | null): string {
  if (!playbook) return 'No matching playbook.';
  return `Playbook "${playbook.title}" (s=${playbook.support}, success=${(playbook.successRate * 100).toFixed(0)}%)\n${playbook.prompt}`;
}

async function executeAttempt(
  task: string,
  attemptNumber: number,
  retryFeedback: string | null,
  baseContext: {
    systemPrompt: string;
    outputStyle: string;
    agentName: string;
    agentGoal: string;
    usedSkills: string[];
    memorySummary: string;
    insightSummary: string;
    soulSummary: string;
    playbookSummary: string;
  }
): Promise<{ output: string; skillOutputs: string[] }> {
  const userMessage = [
    `Task: ${task}`,
    `Attempt: ${attemptNumber}`,
    retryFeedback ? `Retry guidance: ${retryFeedback}` : '',
    `Available skills: ${baseContext.usedSkills.join(', ') || 'none'}`,
    `Workflow: ${defaultWorkflow.map((step) => `${step.name}: ${step.description}`).join(' | ')}`,
    `Soul: ${baseContext.soulSummary}`,
    `Playbook:\n${baseContext.playbookSummary}`,
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
    `Playbook:\n${baseContext.playbookSummary}`,
    baseContext.usedSkills.length > 0
      ? `Suggested execution path: use ${baseContext.usedSkills.join(', ')}.`
      : 'Suggested execution path: respond directly and request a skill only when needed.',
    skillOutputs.length > 0 ? `Skill output:\n${skillOutputs.join('\n\n')}` : 'No skill output available.',
    'Result: task has been analyzed and prepared for execution in the local runtime.'
  ].filter(Boolean).join('\n');

  return { output: modelResponse || fallbackOutput, skillOutputs };
}

async function maybeEvolve(profile: SoulProfile, config: RuntimeConfig): Promise<{ profile: SoulProfile; insights: Insight[]; consolidated: number; playbookCount: number }> {
  const cadence = Math.max(1, config.evolution.insightCadence);
  if (profile.runs === 0 || profile.runs % cadence !== 0) {
    const [insights, playbooks] = await Promise.all([loadInsights(), loadPlaybooks()]);
    return { profile, insights, consolidated: 0, playbookCount: playbooks.length };
  }
  const runs = await loadRuns();
  const recent = runs.slice(0, Math.max(cadence * 2, 6));
  const candidates = deriveCandidateInsights(recent);
  const existing = await loadInsights();
  const { next: nextInsights } = reconcileInsights(existing, candidates);
  await saveInsights(nextInsights);

  let consolidated = 0;
  if (config.evolution.consolidateOnEvolve) {
    const memory = await loadMemory();
    const result = consolidateMemory(memory);
    if (result.merged > 0) {
      await saveMemoryItems(result.items);
      consolidated = result.merged;
    }
  }

  let playbookCount = (await loadPlaybooks()).length;
  if (config.evolution.synthesizePlaybooks) {
    const allRuns = await loadRuns();
    const candidatePlaybooks = deriveCandidatePlaybooks(allRuns.slice(0, 60));
    if (candidatePlaybooks.length > 0) {
      const existingPlaybooks = await loadPlaybooks();
      const nextPlaybooks = reconcilePlaybooks(existingPlaybooks, candidatePlaybooks);
      await savePlaybooks(nextPlaybooks);
      playbookCount = nextPlaybooks.length;
    }
  }

  const evolved = recordEvolution(profile);
  return { profile: evolved, insights: nextInsights, consolidated, playbookCount };
}

async function refreshImportanceInBackground(memory: MemoryItem, content: string, task: string, kind: string): Promise<void> {
  const score = await scoreImportanceWithModel(content, task, kind);
  if (typeof score === 'number') {
    await updateMemoryImportance(memory.id, score);
  }
}

async function embedAndLinkInBackground(memory: MemoryItem, config: RuntimeConfig): Promise<void> {
  const text = `${memory.task}\n${memory.content}`;
  const embedding = await embedWithCache(text);
  if (embedding) {
    await updateMemoryEmbedding(memory.id, embedding);
    memory.embedding = embedding;
  }
  if (config.evolution.linkMemoriesOnWrite) {
    const pool = await loadMemory();
    const peers = topLinkCandidates(memory, pool, LINK_FANOUT, memory.id);
    await updateMemoryLinks(memory.id, peers);
  }
}

export async function runTask(task: string): Promise<RunRecord> {
  const [agent, installedSkills, memory, config, insights, profileRaw, playbooks] = await Promise.all([
    loadAgent(),
    loadInstalledSkills(),
    loadMemory(),
    loadConfig(),
    loadInsights(),
    loadSoulProfile(),
    loadPlaybooks()
  ]);

  const usedSkills = chooseSkills(task, installedSkills, agent.preferredSkills);
  const queryEmbedding = config.evolution.useEmbeddings ? (await embedWithCache(task)) ?? undefined : undefined;
  const retrieved = retrieveMemories(memory, task, MEMORY_TOP_K, config, new Date(), queryEmbedding);
  const applicableInsights = selectApplicableInsights(insights, task, INSIGHT_TOP_K);
  const matchedPlaybook = selectPlaybook(playbooks, task);
  if (matchedPlaybook) {
    for (const skillId of matchedPlaybook.suggestedSkills) {
      if (installedSkills.includes(skillId) && !usedSkills.includes(skillId)) {
        const applicability: Record<string, (task: string) => boolean> = {
          'file-browser': fileApplicable,
          'web-fetch': webApplicable,
          'shell-command': shellApplicable
        };
        const check = applicability[skillId];
        if (!check || check(task)) usedSkills.push(skillId);
      }
    }
  }

  const baseContext = {
    systemPrompt: agent.systemPrompt,
    outputStyle: agent.outputStyle,
    agentName: agent.name,
    agentGoal: agent.goal,
    usedSkills,
    memorySummary: summarizeRetrievedMemory(retrieved),
    insightSummary: summarizeInsights(applicableInsights),
    soulSummary: profileRaw.identity || `runs=${profileRaw.runs} success=${(profileRaw.successRate * 100).toFixed(1)}%`,
    playbookSummary: summarizePlaybook(matchedPlaybook)
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

  const checkerVerdict: CheckerVerdict = await checkRunOutcome(task, output, reflectionDetail, {
    useModel: config.evolution.useCheckerModel
  });

  const ratifiedSuccess = reflectionDetail.success && checkerVerdict.satisfied;
  const status: RunRecord['status'] = ratifiedSuccess ? 'completed' : 'failed';
  const reflection = `${summarizeReflection(reflectionDetail, { task, output, usedSkills })} Checker: ${checkerVerdict.satisfied ? 'satisfied' : 'rejected'} (${checkerVerdict.source}, conf=${checkerVerdict.confidence.toFixed(2)}); ${checkerVerdict.reason}`;

  const draftRun: Omit<RunRecord, 'id' | 'createdAt'> = {
    agent: agent.id,
    task,
    output,
    status,
    usedSkills,
    reflection,
    attempts: attempt,
    reflectionDetail: { ...reflectionDetail, success: ratifiedSuccess },
    retrievedMemoryIds: retrieved.map((entry) => entry.item.id),
    appliedInsightIds: applicableInsights.map((insight) => insight.id),
    checkerVerdict
  };

  const storedRun = await appendRun(draftRun);
  await touchMemory(retrieved.map((entry) => entry.item.id));

  const resultMemory = await appendMemory({
    kind: 'result',
    task,
    content: output,
    tags: ['task', 'result', status]
  });
  const reflectionMemory = await appendMemory({
    kind: 'reflection',
    task,
    content: reflection,
    tags: ['task', 'reflection', status]
  });
  const lessonMemory = await appendMemory({
    kind: 'lesson',
    task,
    content: reflectionDetail.lesson,
    tags: ['task', 'lesson', ...usedSkills],
    importance: reflectionDetail.importance
  });

  const newMemories = [resultMemory, reflectionMemory, lessonMemory];
  if (config.evolution.useEmbeddings || config.evolution.linkMemoriesOnWrite) {
    for (const target of newMemories) {
      enqueueEmbeddingJob(() => embedAndLinkInBackground(target, config));
    }
  }
  if (config.evolution.useLlmImportance) {
    enqueueEmbeddingJob(() => refreshImportanceInBackground(lessonMemory, lessonMemory.content, lessonMemory.task, lessonMemory.kind));
    enqueueEmbeddingJob(() => refreshImportanceInBackground(resultMemory, resultMemory.content, resultMemory.task, resultMemory.kind));
  }

  let updatedProfile = applyRunToSoul(profileRaw, storedRun);
  const evolution = await maybeEvolve(updatedProfile, config);
  updatedProfile = refreshIdentity(evolution.profile, agent, evolution.insights);
  await saveSoulProfile(updatedProfile);

  return storedRun;
}

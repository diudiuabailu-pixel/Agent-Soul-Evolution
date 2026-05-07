import { appendMemory, appendRun, loadAgent, loadInstalledSkills, loadMemory } from './storage.js';
import { createReflection } from './reflection.js';
import { invokeModel } from './model.js';
import { executeSkill } from './skill-runner.js';
import { defaultWorkflow } from './workflow.js';
import type { RunRecord } from '../types.js';

function chooseSkills(task: string, installed: string[]): string[] {
  const lower = task.toLowerCase();
  const picks: string[] = [];
  if ((lower.includes('file') || lower.includes('folder') || lower.includes('directory')) && installed.includes('file-browser')) {
    picks.push('file-browser');
  }
  if ((lower.includes('web') || lower.includes('http') || lower.includes('url')) && installed.includes('web-fetch')) {
    picks.push('web-fetch');
  }
  if ((lower.includes('shell') || lower.includes('command') || lower.includes('bash')) && installed.includes('shell-command')) {
    picks.push('shell-command');
  }
  return picks;
}

function summarizeMemory(matches: string[]): string {
  if (matches.length === 0) {
    return 'No relevant memory found.';
  }
  return `Relevant memory: ${matches.slice(0, 3).join(' | ')}`;
}

function extractLessons(matches: string[]): string[] {
  return matches
    .filter((item) => item.length > 20)
    .slice(0, 3);
}

export async function runTask(task: string): Promise<RunRecord> {
  const agent = await loadAgent();
  const installedSkills = await loadInstalledSkills();
  const memory = await loadMemory();
  const relevantMemory = memory
    .filter((item) => task.toLowerCase().split(/\s+/).some((word) => word.length > 3 && item.content.toLowerCase().includes(word)))
    .map((item) => item.content);

  const usedSkills = Array.from(new Set([...chooseSkills(task, installedSkills), ...agent.preferredSkills.filter((id) => installedSkills.includes(id))]));
  const lessons = extractLessons(relevantMemory);

  const modelResponse = await invokeModel([
    { role: 'system', content: `${agent.systemPrompt}\nOutput style: ${agent.outputStyle}` },
    {
      role: 'user',
      content: [
        `Task: ${task}`,
        `Available skills: ${usedSkills.join(', ') || 'none'}`,
        `Workflow: ${defaultWorkflow.map((step) => `${step.name}: ${step.description}`).join(' | ')}`,
        summarizeMemory(relevantMemory),
        lessons.length > 0 ? `Lessons: ${lessons.join(' | ')}` : 'Lessons: none'
      ].join('\n')
    }
  ]);

  const skillOutputs = [] as string[];
  for (const skillId of usedSkills) {
    try {
      const result = await executeSkill(skillId, task);
      skillOutputs.push(`[${result.skillId}] ${result.summary}\n${result.output}`);
    } catch (error) {
      skillOutputs.push(`[${skillId}] Execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const fallbackOutput = [
    `Agent: ${agent.name}`,
    `Goal: ${agent.goal}`,
    `Task: ${task}`,
    summarizeMemory(relevantMemory),
    usedSkills.length > 0
      ? `Suggested execution path: use ${usedSkills.join(', ')}.`
      : 'Suggested execution path: respond directly and request a skill only when needed.',
    skillOutputs.length > 0 ? `Skill output:\n${skillOutputs.join('\n\n')}` : 'No skill output available.',
    'Result: task has been analyzed and prepared for execution in the local runtime.'
  ].join('\n');

  const output = modelResponse || fallbackOutput;

  const draftRun = {
    agent: agent.id,
    task,
    output,
    status: 'completed' as const,
    usedSkills,
    reflection: ''
  };

  const reflection = createReflection(draftRun);
  const storedRun = await appendRun({ ...draftRun, reflection });

  await appendMemory({
    kind: 'result',
    task,
    content: output,
    tags: ['task', 'result']
  });

  await appendMemory({
    kind: 'reflection',
    task,
    content: reflection,
    tags: ['task', 'reflection']
  });

  await appendMemory({
    kind: 'lesson',
    task,
    content: `Preferred skills: ${usedSkills.join(', ') || 'none'}. ${reflection}`,
    tags: ['task', 'lesson']
  });

  return storedRun;
}

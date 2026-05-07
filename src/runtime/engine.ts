import { appendMemory, appendRun, loadAgent, loadInstalledSkills, loadMemory } from './storage.js';
import { createReflection } from './reflection.js';
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

export async function runTask(task: string): Promise<RunRecord> {
  const agent = await loadAgent();
  const installedSkills = await loadInstalledSkills();
  const memory = await loadMemory();
  const relevantMemory = memory
    .filter((item) => task.toLowerCase().split(/\s+/).some((word) => word.length > 3 && item.content.toLowerCase().includes(word)))
    .map((item) => item.content);

  const usedSkills = chooseSkills(task, installedSkills);
  const output = [
    `Agent: ${agent.name}`,
    `Goal: ${agent.goal}`,
    `Task: ${task}`,
    summarizeMemory(relevantMemory),
    usedSkills.length > 0
      ? `Suggested execution path: use ${usedSkills.join(', ')}.`
      : 'Suggested execution path: respond directly and request a skill only when needed.',
    'Result: task has been analyzed and prepared for execution in the local runtime.'
  ].join('\n');

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

  return storedRun;
}

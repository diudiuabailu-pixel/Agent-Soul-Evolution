import type { RunRecord } from '../types.js';

export function createReflection(run: Pick<RunRecord, 'task' | 'output' | 'usedSkills' | 'status'>): string {
  const base = run.status === 'completed'
    ? 'The task completed successfully.'
    : 'The task did not complete successfully.';

  const skills = run.usedSkills.length > 0
    ? `Skills used: ${run.usedSkills.join(', ')}.`
    : 'No skills were used.';

  const outputHint = run.output.length > 220
    ? `${run.output.slice(0, 220)}...`
    : run.output;

  return [
    base,
    skills,
    `Task summary: ${run.task}.`,
    `Output snapshot: ${outputHint}`,
    'Next time, prefer the shortest valid path, verify assumptions early, and store reusable facts as memory.'
  ].join(' ');
}

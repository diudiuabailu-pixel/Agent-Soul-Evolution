import type { ReflectionResult, RunRecord } from '../types.js';

const FAILURE_SIGNALS = [
  'execution failed',
  'error:',
  'not in the safe allowlist',
  'unable to',
  'denied',
  'timeout',
  'no url was present',
  'no inline shell command'
];

const SUCCESS_SIGNALS = [
  'workspace entries:',
  'fetched ',
  'executed ',
  'command completed',
  'completed successfully',
  'result:'
];

function detectSignals(text: string, signals: string[]): string[] {
  const lower = text.toLowerCase();
  return signals.filter((signal) => lower.includes(signal));
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function deriveLesson(run: Pick<RunRecord, 'task' | 'output' | 'usedSkills'>, success: boolean, signals: string[]): string {
  const skillPart = run.usedSkills.length > 0
    ? `route via ${run.usedSkills.join(', ')}`
    : 'no skill route was taken';

  if (!success) {
    if (signals.includes('not in the safe allowlist')) {
      return `When the request is shell-like, prefer commands inside the safe allowlist (pwd, ls, cat, echo, git) and ${skillPart}.`;
    }
    if (signals.includes('no url was present')) {
      return `For web-fetch tasks, ensure the prompt contains a full URL beginning with http(s) before invoking the skill.`;
    }
    if (signals.includes('no inline shell command')) {
      return `Wrap shell commands in backticks so the runner can extract them; if no command is present, ask for it instead of guessing.`;
    }
    if (signals.includes('execution failed')) {
      return `A skill execution failed; prefer a smaller validated step before invoking the same skill again, and ${skillPart}.`;
    }
    return `Task did not visibly succeed; on retry, narrow the scope and ${skillPart}.`;
  }

  if (run.usedSkills.includes('file-browser')) {
    return `Workspace inspection tasks resolve quickly through file-browser; cite a few entries directly in the answer.`;
  }
  if (run.usedSkills.includes('web-fetch')) {
    return `For URL-grounded tasks, fetch the page once and summarize with the first 200 readable tokens.`;
  }
  if (run.usedSkills.includes('shell-command')) {
    return `Shell answers improve when the command is named in backticks and the output is summarized in one line.`;
  }
  return `Direct responses work for short instructions; capture the user goal and the chosen path explicitly.`;
}

function importanceFromOutcome(success: boolean, signals: string[], outputLength: number): number {
  let value = success ? 4 : 6;
  if (!success && signals.length >= 2) value += 1;
  if (outputLength > 600) value += 1;
  if (outputLength < 60) value -= 1;
  return Math.max(1, Math.min(10, value));
}

export function evaluateOutcome(run: Pick<RunRecord, 'task' | 'output' | 'usedSkills' | 'status'>): ReflectionResult {
  const failureSignals = detectSignals(run.output, FAILURE_SIGNALS);
  const successSignals = detectSignals(run.output, SUCCESS_SIGNALS);
  const success = run.status === 'completed' && failureSignals.length === 0 && (successSignals.length > 0 || run.usedSkills.length === 0);
  const signals = success ? successSignals : failureSignals;

  const observation = success
    ? `Task ran cleanly with ${run.usedSkills.length > 0 ? run.usedSkills.join(', ') : 'no skills'} and produced grounded output.`
    : `Task showed ${failureSignals.length} failure signal(s)${failureSignals.length > 0 ? ` (${failureSignals.join('; ')})` : ''}.`;

  const lesson = deriveLesson(run, success, failureSignals);
  const importance = importanceFromOutcome(success, signals, run.output.length);

  return { success, observation, lesson, importance, signals };
}

export function summarizeReflection(result: ReflectionResult, run: Pick<RunRecord, 'task' | 'output' | 'usedSkills'>): string {
  const verdict = result.success ? 'completed' : 'did not complete cleanly';
  const skills = run.usedSkills.length > 0 ? `Skills used: ${run.usedSkills.join(', ')}.` : 'No skills were used.';
  const snapshot = `Output snapshot: ${shorten(run.output, 220)}`;
  return [
    `The task ${verdict}.`,
    skills,
    `Task: ${shorten(run.task, 160)}.`,
    snapshot,
    `Observation: ${result.observation}`,
    `Lesson: ${result.lesson}`
  ].join(' ');
}

export function buildRetryFeedback(result: ReflectionResult, run: Pick<RunRecord, 'task' | 'output' | 'usedSkills'>): string {
  const skillsHint = run.usedSkills.length > 0
    ? `Previous attempt used ${run.usedSkills.join(', ')}.`
    : 'Previous attempt used no skills.';
  return [
    'Previous attempt did not satisfy the task.',
    skillsHint,
    `Failure signals: ${result.signals.join('; ') || 'none specific'}.`,
    `Adjustment: ${result.lesson}`,
    'Retry with a tighter plan and grounded output.'
  ].join(' ');
}

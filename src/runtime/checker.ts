import { invokeModel } from './model.js';
import type { CheckerVerdict, ReflectionResult } from '../types.js';
import { jaccard, tokenSet } from './memory.js';

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function heuristicVerdict(task: string, output: string, reflection: ReflectionResult): CheckerVerdict {
  const overlap = jaccard(tokenSet(task), tokenSet(output));
  const passes = reflection.success && overlap >= 0.05 && output.length >= 20;
  return {
    satisfied: passes,
    confidence: Math.min(1, 0.4 + overlap * 1.5),
    reason: passes
      ? `Output covers ${(overlap * 100).toFixed(0)}% of task tokens; no failure signals.`
      : `Coverage ${(overlap * 100).toFixed(0)}% with ${reflection.signals.length} failure signal(s); does not clearly satisfy the task.`,
    source: 'heuristic'
  };
}

function parseModelVerdict(raw: string): { satisfied: boolean; confidence: number; reason: string } | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const json = JSON.parse(raw.slice(start, end + 1)) as Partial<{ satisfied: boolean; confidence: number; reason: string }>;
    if (typeof json.satisfied !== 'boolean') return null;
    const confidence = typeof json.confidence === 'number' ? Math.max(0, Math.min(1, json.confidence)) : 0.5;
    const reason = typeof json.reason === 'string' && json.reason.length > 0 ? json.reason : (json.satisfied ? 'satisfied' : 'not satisfied');
    return { satisfied: json.satisfied, confidence, reason };
  } catch {
    return null;
  }
}

export async function checkRunOutcome(
  task: string,
  output: string,
  reflection: ReflectionResult,
  options: { useModel: boolean }
): Promise<CheckerVerdict> {
  if (!options.useModel) {
    return heuristicVerdict(task, output, reflection);
  }

  const prompt = [
    'You are a strict checker. Decide whether the assistant output satisfies the task.',
    'Reply with a single JSON object on one line: {"satisfied": boolean, "confidence": number 0-1, "reason": short string}.',
    'Be conservative: only mark satisfied=true if the output addresses the task and has no obvious errors.',
    `Task: ${shorten(task, 600)}`,
    `Output: ${shorten(output, 1200)}`
  ].join('\n');

  const response = await invokeModel(
    [
      { role: 'system', content: 'You are a strict task verifier. Output JSON only.' },
      { role: 'user', content: prompt }
    ],
    { timeoutMs: 15_000 }
  );

  if (!response) return heuristicVerdict(task, output, reflection);
  const parsed = parseModelVerdict(response);
  if (!parsed) return heuristicVerdict(task, output, reflection);
  return { ...parsed, source: 'model' };
}

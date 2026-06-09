import { invokeModel } from './model.js';

const PROMPT = [
  'Rate how important the assistant memory below is for future reference, on a 1 to 10 integer scale.',
  '1 means trivial daily noise; 5 is a useful working note; 10 is a load-bearing rule, identity, or high-stakes outcome.',
  'Reply with ONE integer between 1 and 10. No words.'
].join('\n');

function clamp(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

export async function scoreImportanceWithModel(content: string, task: string, kind: string): Promise<number | null> {
  const response = await invokeModel(
    [
      { role: 'system', content: 'You are a strict scorer. Output only a single integer 1-10.' },
      { role: 'user', content: `${PROMPT}\nKind: ${kind}\nTask: ${task.slice(0, 400)}\nMemory: ${content.slice(0, 1200)}` }
    ],
    { timeoutMs: 12_000 }
  );
  if (!response) return null;
  const match = response.match(/\b([1-9]|10)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return clamp(value);
}

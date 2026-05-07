import { loadRuns } from './storage.js';
import type { RunRecord } from '../types.js';

export async function getRunById(id: string): Promise<RunRecord | null> {
  const runs = await loadRuns();
  return runs.find((run) => run.id === id) || null;
}

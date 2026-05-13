import fs from 'fs-extra';
import path from 'node:path';
import {
  loadAgent,
  loadInsights,
  loadMemory,
  loadPlaybooks,
  loadRuns,
  loadSoulProfile,
  saveAgent,
  saveInsights,
  saveMemoryItems,
  savePlaybooks,
  saveSoulProfile,
  ensureRuntime
} from './storage.js';
import { getDb, withTx } from './db.js';
import type { AgentProfile, Insight, MemoryItem, Playbook, RunRecord, SoulProfile } from '../types.js';

export type SoulPackage = {
  format: string;
  exportedAt: string;
  agent: AgentProfile;
  soul: SoulProfile;
  memory: MemoryItem[];
  insights: Insight[];
  playbooks: Playbook[];
  runs: RunRecord[];
};

const FORMAT = 'agent-soul-evolution/v1';

export async function buildSoulPackage(): Promise<SoulPackage> {
  await ensureRuntime();
  const [agent, soul, memory, insights, playbooks, runs] = await Promise.all([
    loadAgent(),
    loadSoulProfile(),
    loadMemory(),
    loadInsights(),
    loadPlaybooks(),
    loadRuns()
  ]);
  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    agent,
    soul,
    memory,
    insights,
    playbooks,
    runs
  };
}

export async function exportSoul(targetPath: string): Promise<{ path: string; bytes: number }> {
  const packageData = await buildSoulPackage();
  const text = JSON.stringify(packageData, null, 2);
  const resolved = path.resolve(targetPath);
  await fs.ensureDir(path.dirname(resolved));
  await fs.writeFile(resolved, text, 'utf8');
  const stats = await fs.stat(resolved);
  return { path: resolved, bytes: stats.size };
}

export type ImportResult = {
  agent: boolean;
  soul: boolean;
  memory: number;
  insights: number;
  playbooks: number;
  runs: number;
};

export async function importSoul(sourcePath: string, options: { merge?: boolean } = {}): Promise<ImportResult> {
  const resolved = path.resolve(sourcePath);
  if (!(await fs.pathExists(resolved))) throw new Error(`No soul package at ${resolved}`);
  const raw = (await fs.readJson(resolved)) as Partial<SoulPackage>;
  if (raw.format !== FORMAT) throw new Error(`Unsupported soul package format: ${raw.format}`);

  await ensureRuntime();
  const merge = options.merge !== false;
  const result: ImportResult = { agent: false, soul: false, memory: 0, insights: 0, playbooks: 0, runs: 0 };

  if (raw.agent) {
    await saveAgent({ ...(await loadAgent()), ...raw.agent });
    result.agent = true;
  }
  if (raw.soul) {
    await saveSoulProfile({ ...(await loadSoulProfile()), ...raw.soul });
    result.soul = true;
  }

  const incomingMemory = Array.isArray(raw.memory) ? raw.memory : [];
  const incomingInsights = Array.isArray(raw.insights) ? raw.insights : [];
  const incomingPlaybooks = Array.isArray(raw.playbooks) ? raw.playbooks : [];
  const incomingRuns = Array.isArray(raw.runs) ? raw.runs : [];

  const dedupe = <T extends { id: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.id) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  };

  const memoryAfter = dedupe(merge ? [...incomingMemory, ...(await loadMemory())] : incomingMemory);
  await saveMemoryItems(memoryAfter);
  result.memory = incomingMemory.length;

  const insightsAfter = dedupe(merge ? [...incomingInsights, ...(await loadInsights())] : incomingInsights);
  await saveInsights(insightsAfter);
  result.insights = incomingInsights.length;

  const playbooksAfter = dedupe(merge ? [...incomingPlaybooks, ...(await loadPlaybooks())] : incomingPlaybooks);
  await savePlaybooks(playbooksAfter);
  result.playbooks = incomingPlaybooks.length;

  if (incomingRuns.length > 0) {
    const db = getDb();
    const insert = db.prepare('INSERT OR REPLACE INTO runs (id, created_at, json) VALUES (?, ?, ?)');
    withTx(() => {
      if (!merge) db.prepare('DELETE FROM runs').run();
      for (const run of incomingRuns) {
        if (!run?.id) continue;
        insert.run(run.id, run.createdAt ?? new Date().toISOString(), JSON.stringify(run));
      }
    });
    result.runs = incomingRuns.length;
  }

  return result;
}

import fs from 'fs-extra';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import {
  agentsPath,
  configPath,
  insightsPath,
  installedSkillsPath,
  memoryPath,
  playbooksPath,
  runsPath,
  runtimeRoot,
  skillPackagesRoot,
  soulProfilePath,
  soulRoot
} from './paths.js';
import { emptySoul } from './soul.js';
import { estimateImportance } from './memory.js';
import type {
  AgentProfile,
  Insight,
  MemoryItem,
  Playbook,
  RunRecord,
  RuntimeConfig,
  SoulProfile
} from '../types.js';

const fileLocks = new Map<string, Promise<unknown>>();

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) || Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => { release = resolve; });
  fileLocks.set(filePath, previous.then(() => next));
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (fileLocks.get(filePath) === next) fileLocks.delete(filePath);
  }
}

const defaultConfig: RuntimeConfig = {
  server: { port: 3760 },
  models: {
    default: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b'
    }
  },
  skills: {
    enabled: ['file-browser', 'web-fetch']
  },
  memory: {
    maxItems: 500
  },
  evolution: {
    retryOnFailure: true,
    maxRetries: 1,
    insightCadence: 5,
    recencyHalfLifeHours: 168,
    weightRecency: 1,
    weightImportance: 1,
    weightRelevance: 1,
    useEmbeddings: false,
    useCheckerModel: false,
    consolidateOnEvolve: true,
    useLlmImportance: false,
    linkMemoriesOnWrite: true,
    oneHopExpansion: true,
    synthesizePlaybooks: true
  }
};

const defaultAgent: AgentProfile = {
  id: 'default',
  name: 'Default Agent',
  goal: 'Execute local tasks with tools, memory, and reflection.',
  systemPrompt: 'You are a practical local agent. Prefer clear actions, grounded outputs, and concise summaries.',
  preferredSkills: ['file-browser', 'web-fetch'],
  outputStyle: 'Short operational summary with next action.'
};

function mergeConfig(raw: Partial<RuntimeConfig> | null | undefined): RuntimeConfig {
  const base = raw || {};
  return {
    server: { ...defaultConfig.server, ...(base.server || {}) },
    models: {
      default: { ...defaultConfig.models.default, ...(base.models?.default || {}) }
    },
    skills: {
      enabled: Array.isArray(base.skills?.enabled) ? base.skills!.enabled : defaultConfig.skills.enabled
    },
    memory: { ...defaultConfig.memory, ...(base.memory || {}) },
    evolution: { ...defaultConfig.evolution, ...(base.evolution || {}) }
  };
}

function normalizeMemoryItem(raw: Partial<MemoryItem> & { content?: string; task?: string; kind?: MemoryItem['kind'] }): MemoryItem {
  const content = raw.content ?? '';
  const task = raw.task ?? '';
  const kind = raw.kind ?? 'result';
  const importance = typeof raw.importance === 'number'
    ? raw.importance
    : estimateImportance(content, task, kind);
  const createdAt = raw.createdAt ?? new Date().toISOString();
  return {
    id: raw.id ?? nanoid(),
    createdAt,
    kind,
    task,
    content,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    importance,
    accessCount: typeof raw.accessCount === 'number' ? raw.accessCount : 0,
    lastAccessedAt: typeof raw.lastAccessedAt === 'string' ? raw.lastAccessedAt : createdAt,
    embedding: Array.isArray(raw.embedding) ? raw.embedding : undefined,
    links: Array.isArray(raw.links) ? raw.links : []
  };
}

export async function ensureRuntime(): Promise<void> {
  await fs.ensureDir(runtimeRoot());
  await fs.ensureDir(runtimeRoot() + '/memory');
  await fs.ensureDir(runtimeRoot() + '/runs');
  await fs.ensureDir(runtimeRoot() + '/agents');
  await fs.ensureDir(runtimeRoot() + '/skills');
  await fs.ensureDir(skillPackagesRoot());
  await fs.ensureDir(soulRoot());

  if (!(await fs.pathExists(configPath()))) {
    await fs.writeFile(configPath(), yaml.dump(defaultConfig), 'utf8');
  }
  if (!(await fs.pathExists(memoryPath()))) {
    await fs.writeJson(memoryPath(), [], { spaces: 2 });
  }
  if (!(await fs.pathExists(runsPath()))) {
    await fs.writeJson(runsPath(), [], { spaces: 2 });
  }
  if (!(await fs.pathExists(agentsPath()))) {
    await fs.writeJson(agentsPath(), defaultAgent, { spaces: 2 });
  }
  if (!(await fs.pathExists(installedSkillsPath()))) {
    await fs.writeJson(installedSkillsPath(), ['file-browser', 'web-fetch', 'shell-command'], { spaces: 2 });
  }
  if (!(await fs.pathExists(insightsPath()))) {
    await fs.writeJson(insightsPath(), [], { spaces: 2 });
  }
  if (!(await fs.pathExists(soulProfilePath()))) {
    await fs.writeJson(soulProfilePath(), emptySoul(), { spaces: 2 });
  }
  if (!(await fs.pathExists(playbooksPath()))) {
    await fs.writeJson(playbooksPath(), [], { spaces: 2 });
  }
}

export async function loadPlaybooks(): Promise<Playbook[]> {
  await ensureRuntime();
  const raw = (await fs.readJson(playbooksPath())) as Array<Partial<Playbook>>;
  return raw.map((entry) => ({
    id: entry.id ?? nanoid(),
    title: entry.title ?? 'Untitled playbook',
    trigger: entry.trigger ?? '',
    prompt: entry.prompt ?? '',
    suggestedSkills: Array.isArray(entry.suggestedSkills) ? entry.suggestedSkills : [],
    support: typeof entry.support === 'number' ? entry.support : 1,
    successRate: typeof entry.successRate === 'number' ? entry.successRate : 0,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    updatedAt: entry.updatedAt ?? entry.createdAt ?? new Date().toISOString(),
    origins: Array.isArray(entry.origins) ? entry.origins : []
  }));
}

export async function savePlaybooks(playbooks: Playbook[]): Promise<void> {
  await ensureRuntime();
  await fs.writeJson(playbooksPath(), playbooks, { spaces: 2 });
}

export async function loadConfig(): Promise<RuntimeConfig> {
  await ensureRuntime();
  const raw = await fs.readFile(configPath(), 'utf8');
  const parsed = yaml.load(raw) as Partial<RuntimeConfig> | null | undefined;
  return mergeConfig(parsed);
}

export async function loadMemory(): Promise<MemoryItem[]> {
  await ensureRuntime();
  const raw = (await fs.readJson(memoryPath())) as Array<Partial<MemoryItem>>;
  return raw.map(normalizeMemoryItem);
}

async function loadMemoryUnlocked(): Promise<MemoryItem[]> {
  const raw = (await fs.readJson(memoryPath())) as Array<Partial<MemoryItem>>;
  return raw.map(normalizeMemoryItem);
}

export async function appendMemory(item: Omit<MemoryItem, 'id' | 'createdAt' | 'accessCount' | 'lastAccessedAt' | 'importance'> & { importance?: number }): Promise<MemoryItem> {
  await ensureRuntime();
  const config = await loadConfig();
  return withFileLock(memoryPath(), async () => {
    const items = await loadMemoryUnlocked();
    const createdAt = new Date().toISOString();
    const importance = typeof item.importance === 'number'
      ? item.importance
      : estimateImportance(item.content, item.task, item.kind);
    const record: MemoryItem = {
      id: nanoid(),
      createdAt,
      accessCount: 0,
      lastAccessedAt: createdAt,
      importance,
      kind: item.kind,
      task: item.task,
      content: item.content,
      tags: item.tags
    };
    items.unshift(record);
    const trimmed = items.slice(0, config.memory.maxItems);
    await fs.writeJson(memoryPath(), trimmed, { spaces: 2 });
    return record;
  });
}

export async function saveMemoryItems(items: MemoryItem[]): Promise<void> {
  await ensureRuntime();
  const config = await loadConfig();
  await withFileLock(memoryPath(), async () => {
    await fs.writeJson(memoryPath(), items.slice(0, config.memory.maxItems), { spaces: 2 });
  });
}

export async function updateMemoryEmbedding(id: string, embedding: number[]): Promise<void> {
  await ensureRuntime();
  await withFileLock(memoryPath(), async () => {
    const items = await loadMemoryUnlocked();
    const target = items.find((item) => item.id === id);
    if (!target) return;
    target.embedding = embedding;
    await fs.writeJson(memoryPath(), items, { spaces: 2 });
  });
}

export async function updateMemoryImportance(id: string, importance: number): Promise<void> {
  await ensureRuntime();
  await withFileLock(memoryPath(), async () => {
    const items = await loadMemoryUnlocked();
    const target = items.find((item) => item.id === id);
    if (!target) return;
    target.importance = Math.max(1, Math.min(10, Math.round(importance)));
    await fs.writeJson(memoryPath(), items, { spaces: 2 });
  });
}

export async function deleteMemory(id: string): Promise<boolean> {
  await ensureRuntime();
  return withFileLock(memoryPath(), async () => {
    const items = await loadMemoryUnlocked();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return false;
    for (const item of next) {
      if (item.links?.includes(id)) {
        item.links = item.links.filter((linkId) => linkId !== id);
      }
    }
    await fs.writeJson(memoryPath(), next, { spaces: 2 });
    return true;
  });
}

export async function mergeMemories(ids: string[]): Promise<{ kept: string | null; merged: number }> {
  if (ids.length < 2) return { kept: null, merged: 0 };
  await ensureRuntime();
  return withFileLock(memoryPath(), async () => {
    const items = await loadMemoryUnlocked();
    const targets = items.filter((item) => ids.includes(item.id));
    if (targets.length < 2) return { kept: null, merged: 0 };
    targets.sort((a, b) => b.importance - a.importance);
    const head = targets[0];
    const tail = targets.slice(1);
    head.importance = Math.min(10, head.importance + 1);
    head.accessCount += tail.reduce((sum, item) => sum + item.accessCount, 0);
    head.tags = Array.from(new Set([...(head.tags || []), ...tail.flatMap((item) => item.tags || [])])).slice(0, 8);
    head.links = Array.from(new Set([...(head.links || []), ...tail.flatMap((item) => item.links || [])]))
      .filter((linkId) => !tail.some((item) => item.id === linkId))
      .slice(0, 8);
    const tailIds = new Set(tail.map((item) => item.id));
    const next = items
      .filter((item) => !tailIds.has(item.id))
      .map((item) => {
        if (item.links && item.links.some((linkId) => tailIds.has(linkId))) {
          item.links = item.links.map((linkId) => (tailIds.has(linkId) ? head.id : linkId));
          item.links = Array.from(new Set(item.links));
        }
        return item;
      });
    await fs.writeJson(memoryPath(), next, { spaces: 2 });
    return { kept: head.id, merged: tail.length };
  });
}

export async function updateMemoryLinks(id: string, peerIds: string[]): Promise<void> {
  if (peerIds.length === 0) return;
  await ensureRuntime();
  await withFileLock(memoryPath(), async () => {
    const items = await loadMemoryUnlocked();
    const map = new Map(items.map((item) => [item.id, item]));
    const target = map.get(id);
    if (!target) return;
    const set = new Set(target.links || []);
    for (const peer of peerIds) {
      if (peer === id) continue;
      if (!map.has(peer)) continue;
      set.add(peer);
    }
    target.links = Array.from(set).slice(0, 8);
    for (const peer of peerIds) {
      if (peer === id) continue;
      const peerItem = map.get(peer);
      if (!peerItem) continue;
      const peerSet = new Set(peerItem.links || []);
      peerSet.add(id);
      peerItem.links = Array.from(peerSet).slice(0, 8);
    }
    await fs.writeJson(memoryPath(), items, { spaces: 2 });
  });
}

export async function touchMemory(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureRuntime();
  await withFileLock(memoryPath(), async () => {
    const items = await loadMemoryUnlocked();
    const lookup = new Set(ids);
    const now = new Date().toISOString();
    let changed = false;
    for (const item of items) {
      if (lookup.has(item.id)) {
        item.accessCount += 1;
        item.lastAccessedAt = now;
        changed = true;
      }
    }
    if (changed) await fs.writeJson(memoryPath(), items, { spaces: 2 });
  });
}

export async function loadRuns(): Promise<RunRecord[]> {
  await ensureRuntime();
  const raw = (await fs.readJson(runsPath())) as Array<Partial<RunRecord>>;
  return raw.map((run) => ({
    id: run.id ?? nanoid(),
    task: run.task ?? '',
    agent: run.agent ?? 'default',
    createdAt: run.createdAt ?? new Date().toISOString(),
    status: (run.status === 'failed' ? 'failed' : 'completed') as RunRecord['status'],
    output: run.output ?? '',
    reflection: run.reflection ?? '',
    usedSkills: Array.isArray(run.usedSkills) ? run.usedSkills : [],
    attempts: typeof run.attempts === 'number' ? run.attempts : 1,
    reflectionDetail: run.reflectionDetail,
    retrievedMemoryIds: Array.isArray(run.retrievedMemoryIds) ? run.retrievedMemoryIds : [],
    appliedInsightIds: Array.isArray(run.appliedInsightIds) ? run.appliedInsightIds : [],
    checkerVerdict: run.checkerVerdict,
    steps: Array.isArray(run.steps) ? run.steps : [],
    memoryOps: Array.isArray(run.memoryOps) ? run.memoryOps : [],
    firstAttemptSucceeded: typeof run.firstAttemptSucceeded === 'boolean' ? run.firstAttemptSucceeded : undefined
  }));
}

export async function appendRun(run: Omit<RunRecord, 'id' | 'createdAt'>): Promise<RunRecord> {
  await ensureRuntime();
  return withFileLock(runsPath(), async () => {
    const items = await loadRuns();
    const record: RunRecord = {
      id: nanoid(),
      createdAt: new Date().toISOString(),
      ...run
    };
    items.unshift(record);
    await fs.writeJson(runsPath(), items.slice(0, 200), { spaces: 2 });
    return record;
  });
}

export async function loadAgent(): Promise<AgentProfile> {
  await ensureRuntime();
  const raw = await fs.readJson(agentsPath());
  return {
    ...defaultAgent,
    ...raw,
    preferredSkills: Array.isArray(raw.preferredSkills) ? raw.preferredSkills : defaultAgent.preferredSkills,
    outputStyle: typeof raw.outputStyle === 'string' ? raw.outputStyle : defaultAgent.outputStyle
  };
}

export async function saveAgent(agent: AgentProfile): Promise<void> {
  await ensureRuntime();
  await fs.writeJson(agentsPath(), agent, { spaces: 2 });
}

export async function loadInstalledSkills(): Promise<string[]> {
  await ensureRuntime();
  return fs.readJson(installedSkillsPath());
}

export async function installSkill(id: string): Promise<void> {
  const skills = await loadInstalledSkills();
  if (!skills.includes(id)) {
    skills.push(id);
    await fs.writeJson(installedSkillsPath(), skills, { spaces: 2 });
  }
}

export async function saveConfig(config: RuntimeConfig): Promise<void> {
  await ensureRuntime();
  const merged = mergeConfig(config);
  await fs.writeFile(configPath(), yaml.dump(merged), 'utf8');
}

export async function loadInsights(): Promise<Insight[]> {
  await ensureRuntime();
  const raw = (await fs.readJson(insightsPath())) as Array<Partial<Insight>>;
  return raw.map((insight) => ({
    id: insight.id ?? nanoid(),
    content: insight.content ?? '',
    support: typeof insight.support === 'number' ? insight.support : 1,
    confidence: typeof insight.confidence === 'number' ? insight.confidence : 0.3,
    createdAt: insight.createdAt ?? new Date().toISOString(),
    updatedAt: insight.updatedAt ?? insight.createdAt ?? new Date().toISOString(),
    origins: Array.isArray(insight.origins) ? insight.origins : [],
    tags: Array.isArray(insight.tags) ? insight.tags : []
  }));
}

export async function saveInsights(insights: Insight[]): Promise<void> {
  await ensureRuntime();
  await fs.writeJson(insightsPath(), insights, { spaces: 2 });
}

export async function loadSoulProfile(): Promise<SoulProfile> {
  await ensureRuntime();
  const raw = await fs.readJson(soulProfilePath());
  return {
    ...emptySoul(),
    ...raw,
    skillStats: typeof raw?.skillStats === 'object' && raw.skillStats !== null ? raw.skillStats : {},
    firstAttemptSuccesses: typeof raw?.firstAttemptSuccesses === 'number' ? raw.firstAttemptSuccesses : 0,
    retryAttempts: typeof raw?.retryAttempts === 'number' ? raw.retryAttempts : 0,
    retrySuccesses: typeof raw?.retrySuccesses === 'number' ? raw.retrySuccesses : 0,
    retryUplift: typeof raw?.retryUplift === 'number' ? raw.retryUplift : 0
  };
}

export async function saveSoulProfile(profile: SoulProfile): Promise<void> {
  await ensureRuntime();
  await fs.writeJson(soulProfilePath(), profile, { spaces: 2 });
}

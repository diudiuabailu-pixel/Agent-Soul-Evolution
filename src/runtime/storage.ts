import fs from 'fs-extra';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import {
  agentsPath,
  configPath,
  insightsPath,
  installedSkillsPath,
  memoryPath,
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
  RunRecord,
  RuntimeConfig,
  SoulProfile
} from '../types.js';

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
    weightRelevance: 1
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
    lastAccessedAt: typeof raw.lastAccessedAt === 'string' ? raw.lastAccessedAt : createdAt
  };
}

export async function ensureRuntime(): Promise<void> {
  await fs.ensureDir(runtimeRoot);
  await fs.ensureDir(runtimeRoot + '/memory');
  await fs.ensureDir(runtimeRoot + '/runs');
  await fs.ensureDir(runtimeRoot + '/agents');
  await fs.ensureDir(runtimeRoot + '/skills');
  await fs.ensureDir(skillPackagesRoot);
  await fs.ensureDir(soulRoot);

  if (!(await fs.pathExists(configPath))) {
    await fs.writeFile(configPath, yaml.dump(defaultConfig), 'utf8');
  }
  if (!(await fs.pathExists(memoryPath))) {
    await fs.writeJson(memoryPath, [], { spaces: 2 });
  }
  if (!(await fs.pathExists(runsPath))) {
    await fs.writeJson(runsPath, [], { spaces: 2 });
  }
  if (!(await fs.pathExists(agentsPath))) {
    await fs.writeJson(agentsPath, defaultAgent, { spaces: 2 });
  }
  if (!(await fs.pathExists(installedSkillsPath))) {
    await fs.writeJson(installedSkillsPath, ['file-browser', 'web-fetch', 'shell-command'], { spaces: 2 });
  }
  if (!(await fs.pathExists(insightsPath))) {
    await fs.writeJson(insightsPath, [], { spaces: 2 });
  }
  if (!(await fs.pathExists(soulProfilePath))) {
    await fs.writeJson(soulProfilePath, emptySoul(), { spaces: 2 });
  }
}

export async function loadConfig(): Promise<RuntimeConfig> {
  await ensureRuntime();
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = yaml.load(raw) as Partial<RuntimeConfig> | null | undefined;
  return mergeConfig(parsed);
}

export async function loadMemory(): Promise<MemoryItem[]> {
  await ensureRuntime();
  const raw = (await fs.readJson(memoryPath)) as Array<Partial<MemoryItem>>;
  return raw.map(normalizeMemoryItem);
}

export async function appendMemory(item: Omit<MemoryItem, 'id' | 'createdAt' | 'accessCount' | 'lastAccessedAt' | 'importance'> & { importance?: number }): Promise<MemoryItem> {
  const items = await loadMemory();
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
  const config = await loadConfig();
  const trimmed = items.slice(0, config.memory.maxItems);
  await fs.writeJson(memoryPath, trimmed, { spaces: 2 });
  return record;
}

export async function touchMemory(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const items = await loadMemory();
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
  if (changed) await fs.writeJson(memoryPath, items, { spaces: 2 });
}

export async function loadRuns(): Promise<RunRecord[]> {
  await ensureRuntime();
  const raw = (await fs.readJson(runsPath)) as Array<Partial<RunRecord>>;
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
    appliedInsightIds: Array.isArray(run.appliedInsightIds) ? run.appliedInsightIds : []
  }));
}

export async function appendRun(run: Omit<RunRecord, 'id' | 'createdAt'>): Promise<RunRecord> {
  const items = await loadRuns();
  const record: RunRecord = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...run
  };
  items.unshift(record);
  await fs.writeJson(runsPath, items.slice(0, 200), { spaces: 2 });
  return record;
}

export async function loadAgent(): Promise<AgentProfile> {
  await ensureRuntime();
  const raw = await fs.readJson(agentsPath);
  return {
    ...defaultAgent,
    ...raw,
    preferredSkills: Array.isArray(raw.preferredSkills) ? raw.preferredSkills : defaultAgent.preferredSkills,
    outputStyle: typeof raw.outputStyle === 'string' ? raw.outputStyle : defaultAgent.outputStyle
  };
}

export async function saveAgent(agent: AgentProfile): Promise<void> {
  await ensureRuntime();
  await fs.writeJson(agentsPath, agent, { spaces: 2 });
}

export async function loadInstalledSkills(): Promise<string[]> {
  await ensureRuntime();
  return fs.readJson(installedSkillsPath);
}

export async function installSkill(id: string): Promise<void> {
  const skills = await loadInstalledSkills();
  if (!skills.includes(id)) {
    skills.push(id);
    await fs.writeJson(installedSkillsPath, skills, { spaces: 2 });
  }
}

export async function saveConfig(config: RuntimeConfig): Promise<void> {
  await ensureRuntime();
  const merged = mergeConfig(config);
  await fs.writeFile(configPath, yaml.dump(merged), 'utf8');
}

export async function loadInsights(): Promise<Insight[]> {
  await ensureRuntime();
  const raw = (await fs.readJson(insightsPath)) as Array<Partial<Insight>>;
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
  await fs.writeJson(insightsPath, insights, { spaces: 2 });
}

export async function loadSoulProfile(): Promise<SoulProfile> {
  await ensureRuntime();
  const raw = await fs.readJson(soulProfilePath);
  return {
    ...emptySoul(),
    ...raw,
    skillStats: typeof raw?.skillStats === 'object' && raw.skillStats !== null ? raw.skillStats : {}
  };
}

export async function saveSoulProfile(profile: SoulProfile): Promise<void> {
  await ensureRuntime();
  await fs.writeJson(soulProfilePath, profile, { spaces: 2 });
}

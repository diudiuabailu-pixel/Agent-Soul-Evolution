import fs from 'fs-extra';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import { agentsPath, configPath, installedSkillsPath, memoryPath, runsPath, runtimeRoot, skillPackagesRoot } from './paths.js';
import type { AgentProfile, MemoryItem, RunRecord, RuntimeConfig } from '../types.js';

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

export async function ensureRuntime(): Promise<void> {
  await fs.ensureDir(runtimeRoot);
  await fs.ensureDir(runtimeRoot + '/memory');
  await fs.ensureDir(runtimeRoot + '/runs');
  await fs.ensureDir(runtimeRoot + '/agents');
  await fs.ensureDir(runtimeRoot + '/skills');
  await fs.ensureDir(skillPackagesRoot);

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
}

export async function loadConfig(): Promise<RuntimeConfig> {
  await ensureRuntime();
  const raw = await fs.readFile(configPath, 'utf8');
  return yaml.load(raw) as RuntimeConfig;
}

export async function loadMemory(): Promise<MemoryItem[]> {
  await ensureRuntime();
  return fs.readJson(memoryPath);
}

export async function appendMemory(item: Omit<MemoryItem, 'id' | 'createdAt'>): Promise<MemoryItem> {
  const items = await loadMemory();
  const record: MemoryItem = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...item
  };
  items.unshift(record);
  const config = await loadConfig();
  const trimmed = items.slice(0, config.memory.maxItems);
  await fs.writeJson(memoryPath, trimmed, { spaces: 2 });
  return record;
}

export async function loadRuns(): Promise<RunRecord[]> {
  await ensureRuntime();
  return fs.readJson(runsPath);
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
  await fs.writeFile(configPath, yaml.dump(config), 'utf8');
}

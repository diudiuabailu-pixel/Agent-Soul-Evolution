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
import { getDb, getSingleton, setSingleton, withTx } from './db.js';
import type {
  AgentProfile,
  Insight,
  MemoryItem,
  Playbook,
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
    weightRelevance: 1,
    useEmbeddings: false,
    useCheckerModel: false,
    consolidateOnEvolve: true,
    useLlmImportance: false,
    linkMemoriesOnWrite: true,
    oneHopExpansion: true,
    synthesizePlaybooks: true,
    forestOfThoughtSamples: 1,
    forestOfThoughtThreshold: 0.3,
    memoryProvenance: false
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
    models: { default: { ...defaultConfig.models.default, ...(base.models?.default || {}) } },
    skills: {
      enabled: Array.isArray(base.skills?.enabled) ? base.skills!.enabled : defaultConfig.skills.enabled
    },
    memory: { ...defaultConfig.memory, ...(base.memory || {}) },
    evolution: { ...defaultConfig.evolution, ...(base.evolution || {}) }
  };
}

function normalizeMemoryRow(row: Record<string, unknown>): MemoryItem {
  const tags = typeof row.tags === 'string' ? safeParseArray<string>(row.tags) : Array.isArray(row.tags) ? (row.tags as string[]) : [];
  const links = typeof row.links === 'string' ? safeParseArray<string>(row.links) : Array.isArray(row.links) ? (row.links as string[]) : [];
  const embedding = typeof row.embedding === 'string' && row.embedding ? safeParseArray<number>(row.embedding) : undefined;
  let provenance;
  if (typeof row.provenance === 'string' && row.provenance) {
    try { provenance = JSON.parse(row.provenance); } catch { provenance = undefined; }
  }
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    kind: row.kind as MemoryItem['kind'],
    task: String(row.task),
    content: String(row.content),
    tags,
    importance: Number(row.importance),
    accessCount: Number(row.access_count ?? 0),
    lastAccessedAt: String(row.last_accessed_at),
    embedding,
    links,
    provenance
  };
}

function safeParseArray<T>(text: string): T[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function migrateLegacyJson(): Promise<void> {
  const db = getDb();
  if (await fs.pathExists(memoryPath())) {
    try {
      const raw = (await fs.readJson(memoryPath())) as Array<Partial<MemoryItem>>;
      const insert = db.prepare(`INSERT OR IGNORE INTO memory
        (id, kind, task, content, importance, access_count, created_at, last_accessed_at, tags, embedding, links)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      withTx(() => {
        for (const entry of raw) {
          if (!entry || !entry.id) continue;
          insert.run(
            entry.id,
            entry.kind ?? 'result',
            entry.task ?? '',
            entry.content ?? '',
            typeof entry.importance === 'number' ? entry.importance : estimateImportance(entry.content ?? '', entry.task ?? '', entry.kind ?? 'result'),
            typeof entry.accessCount === 'number' ? entry.accessCount : 0,
            entry.createdAt ?? new Date().toISOString(),
            entry.lastAccessedAt ?? entry.createdAt ?? new Date().toISOString(),
            JSON.stringify(Array.isArray(entry.tags) ? entry.tags : []),
            Array.isArray(entry.embedding) ? JSON.stringify(entry.embedding) : null,
            JSON.stringify(Array.isArray(entry.links) ? entry.links : [])
          );
        }
      });
      await fs.move(memoryPath(), memoryPath() + '.migrated', { overwrite: true });
    } catch { /* swallow malformed legacy file */ }
  }

  for (const [file, table] of [[runsPath(), 'runs'], [insightsPath(), 'insights'], [playbooksPath(), 'playbooks']]) {
    if (!(await fs.pathExists(file))) continue;
    try {
      const raw = (await fs.readJson(file)) as Array<{ id?: string; updatedAt?: string; createdAt?: string }>;
      const placeholder = table === 'runs'
        ? db.prepare('INSERT OR IGNORE INTO runs (id, created_at, json) VALUES (?, ?, ?)')
        : db.prepare(`INSERT OR IGNORE INTO ${table} (id, updated_at, json) VALUES (?, ?, ?)`);
      withTx(() => {
        for (const entry of raw) {
          if (!entry?.id) continue;
          const timeKey = table === 'runs' ? (entry.createdAt ?? new Date().toISOString()) : (entry.updatedAt ?? entry.createdAt ?? new Date().toISOString());
          placeholder.run(entry.id, timeKey, JSON.stringify(entry));
        }
      });
      await fs.move(file, file + '.migrated', { overwrite: true });
    } catch { /* swallow malformed legacy file */ }
  }

  if (await fs.pathExists(soulProfilePath())) {
    try {
      const raw = await fs.readJson(soulProfilePath());
      setSingleton('soul', raw);
      await fs.move(soulProfilePath(), soulProfilePath() + '.migrated', { overwrite: true });
    } catch { /* swallow */ }
  }
  if (await fs.pathExists(agentsPath())) {
    try {
      const raw = await fs.readJson(agentsPath());
      setSingleton('agent', raw);
      await fs.move(agentsPath(), agentsPath() + '.migrated', { overwrite: true });
    } catch { /* swallow */ }
  }
  if (await fs.pathExists(installedSkillsPath())) {
    try {
      const raw = (await fs.readJson(installedSkillsPath())) as string[];
      const insert = db.prepare('INSERT OR IGNORE INTO installed_skills (id) VALUES (?)');
      withTx(() => { for (const id of raw) insert.run(id); });
      await fs.move(installedSkillsPath(), installedSkillsPath() + '.migrated', { overwrite: true });
    } catch { /* swallow */ }
  }
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

  getDb();
  await migrateLegacyJson();

  if (getSingleton('soul') === null) setSingleton('soul', emptySoul());
  if (getSingleton('agent') === null) setSingleton('agent', defaultAgent);

  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS n FROM installed_skills').get() as { n: number }).n;
  if (count === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO installed_skills (id) VALUES (?)');
    for (const id of ['file-browser', 'web-fetch', 'shell-command']) insert.run(id);
  }
}

export async function loadConfig(): Promise<RuntimeConfig> {
  await ensureRuntime();
  const raw = await fs.readFile(configPath(), 'utf8');
  const parsed = yaml.load(raw) as Partial<RuntimeConfig> | null | undefined;
  return mergeConfig(parsed);
}

export async function saveConfig(config: RuntimeConfig): Promise<void> {
  await ensureRuntime();
  await fs.writeFile(configPath(), yaml.dump(mergeConfig(config)), 'utf8');
}

export async function loadMemory(): Promise<MemoryItem[]> {
  await ensureRuntime();
  const rows = getDb().prepare('SELECT * FROM memory ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(normalizeMemoryRow);
}

export async function appendMemory(item: Omit<MemoryItem, 'id' | 'createdAt' | 'accessCount' | 'lastAccessedAt' | 'importance'> & { importance?: number }): Promise<MemoryItem> {
  await ensureRuntime();
  const config = await loadConfig();
  const createdAt = new Date().toISOString();
  const importance = typeof item.importance === 'number'
    ? Math.max(1, Math.min(10, Math.round(item.importance)))
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
    tags: item.tags,
    links: []
  };
  const db = getDb();
  let provenanceJson: string | null = null;
  if (config.evolution.memoryProvenance) {
    const { makeProvenance } = await import('./governance.js');
    record.provenance = makeProvenance(record, 'engine');
    provenanceJson = JSON.stringify(record.provenance);
  }
  db.prepare(`INSERT INTO memory (id, kind, task, content, importance, access_count, created_at, last_accessed_at, tags, links, provenance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    record.id,
    record.kind,
    record.task,
    record.content,
    record.importance,
    record.accessCount,
    record.createdAt,
    record.lastAccessedAt,
    JSON.stringify(record.tags),
    JSON.stringify(record.links ?? []),
    provenanceJson
  );
  const total = (db.prepare('SELECT COUNT(*) AS n FROM memory').get() as { n: number }).n;
  if (total > config.memory.maxItems) {
    db.prepare(`DELETE FROM memory WHERE id IN (
      SELECT id FROM memory ORDER BY created_at ASC LIMIT ?
    )`).run(total - config.memory.maxItems);
  }
  return record;
}

export async function saveMemoryItems(items: MemoryItem[]): Promise<void> {
  await ensureRuntime();
  const config = await loadConfig();
  const trimmed = items.slice(0, config.memory.maxItems);
  const db = getDb();
  const insert = db.prepare(`INSERT OR REPLACE INTO memory
    (id, kind, task, content, importance, access_count, created_at, last_accessed_at, tags, embedding, links)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  withTx(() => {
    db.prepare('DELETE FROM memory').run();
    for (const item of trimmed) {
      insert.run(
        item.id,
        item.kind,
        item.task,
        item.content,
        item.importance,
        item.accessCount,
        item.createdAt,
        item.lastAccessedAt,
        JSON.stringify(item.tags ?? []),
        Array.isArray(item.embedding) ? JSON.stringify(item.embedding) : null,
        JSON.stringify(item.links ?? [])
      );
    }
  });
}

export async function updateMemoryEmbedding(id: string, embedding: number[]): Promise<void> {
  await ensureRuntime();
  getDb().prepare('UPDATE memory SET embedding = ? WHERE id = ?').run(JSON.stringify(embedding), id);
}

export async function updateMemoryImportance(id: string, importance: number): Promise<void> {
  await ensureRuntime();
  const clamped = Math.max(1, Math.min(10, Math.round(importance)));
  getDb().prepare('UPDATE memory SET importance = ? WHERE id = ?').run(clamped, id);
}

export async function deleteMemory(id: string): Promise<boolean> {
  await ensureRuntime();
  const db = getDb();
  const removed = db.prepare('DELETE FROM memory WHERE id = ?').run(id);
  if (removed.changes === 0) return false;
  const rows = db.prepare("SELECT id, links FROM memory WHERE links LIKE '%' || ? || '%'").all(id) as Array<{ id: string; links: string }>;
  const update = db.prepare('UPDATE memory SET links = ? WHERE id = ?');
  for (const row of rows) {
    const links = safeParseArray<string>(row.links).filter((linkId) => linkId !== id);
    update.run(JSON.stringify(links), row.id);
  }
  return true;
}

export async function mergeMemories(ids: string[]): Promise<{ kept: string | null; merged: number }> {
  if (ids.length < 2) return { kept: null, merged: 0 };
  await ensureRuntime();
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM memory WHERE id IN (${placeholders})`).all(...ids) as Record<string, unknown>[];
  if (rows.length < 2) return { kept: null, merged: 0 };
  const targets = rows.map(normalizeMemoryRow);
  targets.sort((a, b) => b.importance - a.importance);
  const head = targets[0];
  const tail = targets.slice(1);
  const tailIds = new Set(tail.map((entry) => entry.id));
  head.importance = Math.min(10, head.importance + 1);
  head.accessCount += tail.reduce((sum, entry) => sum + entry.accessCount, 0);
  head.tags = Array.from(new Set([...(head.tags || []), ...tail.flatMap((entry) => entry.tags || [])])).slice(0, 8);
  head.links = Array.from(new Set([...(head.links || []), ...tail.flatMap((entry) => entry.links || [])]))
    .filter((linkId) => !tailIds.has(linkId))
    .slice(0, 8);
  withTx(() => {
    const del = db.prepare('DELETE FROM memory WHERE id = ?');
    for (const id of tailIds) del.run(id);
    db.prepare('UPDATE memory SET importance = ?, access_count = ?, tags = ?, links = ? WHERE id = ?')
      .run(head.importance, head.accessCount, JSON.stringify(head.tags), JSON.stringify(head.links), head.id);
    const linkRows = db.prepare('SELECT id, links FROM memory').all() as Array<{ id: string; links: string }>;
    const update = db.prepare('UPDATE memory SET links = ? WHERE id = ?');
    for (const row of linkRows) {
      const next = safeParseArray<string>(row.links).map((linkId) => (tailIds.has(linkId) ? head.id : linkId));
      const deduped = Array.from(new Set(next));
      update.run(JSON.stringify(deduped), row.id);
    }
  });
  return { kept: head.id, merged: tail.length };
}

export async function updateMemoryLinks(id: string, peerIds: string[]): Promise<void> {
  if (peerIds.length === 0) return;
  await ensureRuntime();
  const db = getDb();
  const target = db.prepare('SELECT id, links FROM memory WHERE id = ?').get(id) as { id: string; links: string } | undefined;
  if (!target) return;
  const cleanPeers = peerIds.filter((peer) => peer !== id);
  if (cleanPeers.length === 0) return;
  const existingMap = new Map<string, string>();
  const peerRows = db.prepare(`SELECT id, links FROM memory WHERE id IN (${cleanPeers.map(() => '?').join(',')})`).all(...cleanPeers) as Array<{ id: string; links: string }>;
  for (const row of peerRows) existingMap.set(row.id, row.links);
  const set = new Set(safeParseArray<string>(target.links));
  for (const peer of cleanPeers) {
    if (existingMap.has(peer)) set.add(peer);
  }
  db.prepare('UPDATE memory SET links = ? WHERE id = ?').run(JSON.stringify(Array.from(set).slice(0, 8)), id);
  const update = db.prepare('UPDATE memory SET links = ? WHERE id = ?');
  for (const peer of cleanPeers) {
    const existing = existingMap.get(peer);
    if (typeof existing !== 'string') continue;
    const peerSet = new Set(safeParseArray<string>(existing));
    peerSet.add(id);
    update.run(JSON.stringify(Array.from(peerSet).slice(0, 8)), peer);
  }
}

export async function touchMemory(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureRuntime();
  const now = new Date().toISOString();
  const db = getDb();
  const update = db.prepare('UPDATE memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?');
  withTx(() => { for (const id of ids) update.run(now, id); });
}

function normalizeRunRow(row: { json: string }): RunRecord {
  try {
    return JSON.parse(row.json) as RunRecord;
  } catch {
    return {} as RunRecord;
  }
}

export async function loadRuns(): Promise<RunRecord[]> {
  await ensureRuntime();
  const rows = getDb().prepare('SELECT json FROM runs ORDER BY created_at DESC LIMIT 200').all() as Array<{ json: string }>;
  return rows.map(normalizeRunRow);
}

export async function appendRun(run: Omit<RunRecord, 'id' | 'createdAt'>): Promise<RunRecord> {
  await ensureRuntime();
  const record: RunRecord = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...run
  };
  const db = getDb();
  db.prepare('INSERT INTO runs (id, created_at, json) VALUES (?, ?, ?)').run(record.id, record.createdAt, JSON.stringify(record));
  const count = (db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n;
  if (count > 200) {
    db.prepare('DELETE FROM runs WHERE id IN (SELECT id FROM runs ORDER BY created_at ASC LIMIT ?)').run(count - 200);
  }
  return record;
}

export async function loadAgent(): Promise<AgentProfile> {
  await ensureRuntime();
  const raw = (getSingleton('agent') as Partial<AgentProfile>) ?? {};
  return {
    ...defaultAgent,
    ...raw,
    preferredSkills: Array.isArray(raw.preferredSkills) ? raw.preferredSkills : defaultAgent.preferredSkills,
    outputStyle: typeof raw.outputStyle === 'string' ? raw.outputStyle : defaultAgent.outputStyle
  };
}

export async function saveAgent(agent: AgentProfile): Promise<void> {
  await ensureRuntime();
  setSingleton('agent', agent);
}

export async function loadInstalledSkills(): Promise<string[]> {
  await ensureRuntime();
  const rows = getDb().prepare('SELECT id FROM installed_skills').all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export async function installSkill(id: string): Promise<void> {
  await ensureRuntime();
  getDb().prepare('INSERT OR IGNORE INTO installed_skills (id) VALUES (?)').run(id);
}

export async function loadInsights(): Promise<Insight[]> {
  await ensureRuntime();
  const rows = getDb().prepare('SELECT json FROM insights').all() as Array<{ json: string }>;
  return rows
    .map((row) => { try { return JSON.parse(row.json) as Insight; } catch { return null; } })
    .filter((entry): entry is Insight => Boolean(entry));
}

export async function saveInsights(insights: Insight[]): Promise<void> {
  await ensureRuntime();
  const db = getDb();
  const insert = db.prepare('INSERT OR REPLACE INTO insights (id, json, updated_at) VALUES (?, ?, ?)');
  withTx(() => {
    db.prepare('DELETE FROM insights').run();
    for (const insight of insights) {
      insert.run(insight.id, JSON.stringify(insight), insight.updatedAt ?? new Date().toISOString());
    }
  });
}

export async function loadPlaybooks(): Promise<Playbook[]> {
  await ensureRuntime();
  const rows = getDb().prepare('SELECT json FROM playbooks ORDER BY updated_at DESC').all() as Array<{ json: string }>;
  return rows
    .map((row) => { try { return JSON.parse(row.json) as Playbook; } catch { return null; } })
    .filter((entry): entry is Playbook => Boolean(entry));
}

export async function savePlaybooks(playbooks: Playbook[]): Promise<void> {
  await ensureRuntime();
  const db = getDb();
  const insert = db.prepare('INSERT OR REPLACE INTO playbooks (id, json, updated_at) VALUES (?, ?, ?)');
  withTx(() => {
    db.prepare('DELETE FROM playbooks').run();
    for (const playbook of playbooks) {
      insert.run(playbook.id, JSON.stringify(playbook), playbook.updatedAt ?? new Date().toISOString());
    }
  });
}

export async function loadSoulProfile(): Promise<SoulProfile> {
  await ensureRuntime();
  const raw = (getSingleton('soul') as Partial<SoulProfile>) ?? {};
  const defaults = emptySoul();
  return {
    ...defaults,
    ...raw,
    skillStats: typeof raw?.skillStats === 'object' && raw.skillStats !== null ? raw.skillStats as SoulProfile['skillStats'] : {},
    firstAttemptSuccesses: typeof raw?.firstAttemptSuccesses === 'number' ? raw.firstAttemptSuccesses : 0,
    retryAttempts: typeof raw?.retryAttempts === 'number' ? raw.retryAttempts : 0,
    retrySuccesses: typeof raw?.retrySuccesses === 'number' ? raw.retrySuccesses : 0,
    retryUplift: typeof raw?.retryUplift === 'number' ? raw.retryUplift : 0,
    lifetimeTokens: typeof raw?.lifetimeTokens === 'object' && raw.lifetimeTokens !== null ? raw.lifetimeTokens : defaults.lifetimeTokens,
    lifetimeMs: typeof raw?.lifetimeMs === 'number' ? raw.lifetimeMs : 0,
    checkerCalibration: typeof raw?.checkerCalibration === 'object' && raw.checkerCalibration !== null ? raw.checkerCalibration : defaults.checkerCalibration
  };
}

export async function saveSoulProfile(profile: SoulProfile): Promise<void> {
  await ensureRuntime();
  setSingleton('soul', profile);
}

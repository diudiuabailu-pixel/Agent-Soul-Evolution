import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import { embeddingsCachePath } from './paths.js';
import { invokeEmbedding } from './model.js';

const MAX_ENTRIES = 4000;

type CacheShape = {
  version: number;
  entries: Record<string, { vector: number[]; updatedAt: string; hits: number }>;
};

let memoryCache: CacheShape | null = null;
let memoryCachePath: string | null = null;
let saveTimer: NodeJS.Timeout | null = null;
const inflight = new Map<string, Promise<number[] | null>>();

export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function loadCache(): Promise<CacheShape> {
  const currentPath = embeddingsCachePath();
  if (memoryCache && memoryCachePath === currentPath) return memoryCache;
  memoryCachePath = currentPath;
  if (!(await fs.pathExists(currentPath))) {
    memoryCache = { version: 1, entries: {} };
    return memoryCache;
  }
  try {
    const raw = await fs.readJson(currentPath);
    memoryCache = {
      version: typeof raw?.version === 'number' ? raw.version : 1,
      entries: raw?.entries && typeof raw.entries === 'object' ? raw.entries : {}
    };
  } catch {
    memoryCache = { version: 1, entries: {} };
  }
  return memoryCache;
}

function scheduleFlush(): void {
  if (saveTimer) return;
  const timer = setTimeout(async () => {
    saveTimer = null;
    if (!memoryCache) return;
    const entries = Object.entries(memoryCache.entries);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => (b[1].hits - a[1].hits) || (new Date(b[1].updatedAt).getTime() - new Date(a[1].updatedAt).getTime()));
      memoryCache.entries = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    try {
      await fs.outputJson(memoryCachePath || embeddingsCachePath(), memoryCache, { spaces: 0 });
    } catch {
      /* swallow disk errors; cache remains in memory */
    }
  }, 200);
  timer.unref?.();
  saveTimer = timer;
}

export async function getCachedEmbedding(text: string): Promise<number[] | null> {
  const cache = await loadCache();
  const key = hashContent(text);
  const entry = cache.entries[key];
  if (!entry) return null;
  entry.hits += 1;
  entry.updatedAt = new Date().toISOString();
  scheduleFlush();
  return entry.vector;
}

export async function rememberEmbedding(text: string, vector: number[]): Promise<void> {
  const cache = await loadCache();
  cache.entries[hashContent(text)] = {
    vector,
    updatedAt: new Date().toISOString(),
    hits: 1
  };
  scheduleFlush();
}

export async function embedWithCache(text: string): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;
  const cached = await getCachedEmbedding(text);
  if (cached) return cached;
  const key = hashContent(text);
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const vector = await invokeEmbedding(text);
    if (vector) await rememberEmbedding(text, vector);
    return vector;
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

const queue: Array<() => Promise<void>> = [];
let queueRunning = false;

async function drainQueue(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) continue;
      try { await job(); } catch { /* swallow background errors */ }
    }
  } finally {
    queueRunning = false;
  }
}

export function enqueueEmbeddingJob(job: () => Promise<void>): void {
  queue.push(job);
  void drainQueue();
}

export function pendingEmbeddingJobs(): number {
  return queue.length;
}

export async function flushEmbeddings(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!memoryCache) return;
  await fs.outputJson(memoryCachePath || embeddingsCachePath(), memoryCache, { spaces: 0 });
}

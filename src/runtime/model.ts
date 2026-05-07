import { loadConfig } from './storage.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function callOnce(endpoint: string, body: unknown, timeoutMs: number): Promise<Response | null> {
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs
    });
    return response;
  } catch {
    return null;
  }
}

async function callWithRetry(endpoint: string, body: unknown, timeoutMs: number): Promise<Response | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await callOnce(endpoint, body, timeoutMs);
    if (response && response.ok) return response;
    if (response && response.status >= 400 && response.status < 500) return response;
  }
  return null;
}

export async function invokeModel(messages: ChatMessage[], options: { timeoutMs?: number } = {}): Promise<string | null> {
  const config = await loadConfig();
  const endpoint = `${config.models.default.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await callWithRetry(endpoint, {
    model: config.models.default.model,
    messages,
    temperature: 0.2
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  if (!response || !response.ok) return null;

  try {
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) return content.map((item) => item.text || '').join('').trim() || null;
    return null;
  } catch {
    return null;
  }
}

export async function invokeEmbedding(input: string, options: { timeoutMs?: number } = {}): Promise<number[] | null> {
  const config = await loadConfig();
  const endpoint = `${config.models.default.baseUrl.replace(/\/$/, '')}/embeddings`;

  const response = await callWithRetry(endpoint, {
    model: config.models.default.model,
    input
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  if (!response || !response.ok) return null;

  try {
    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (Array.isArray(embedding) && embedding.every((value) => typeof value === 'number')) {
      return embedding;
    }
    return null;
  } catch {
    return null;
  }
}

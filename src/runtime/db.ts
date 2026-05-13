import path from 'node:path';
import fs from 'fs-extra';
import Database from 'better-sqlite3';
import { runtimeRoot } from './paths.js';

let cached: { handle: Database.Database; dir: string } | null = null;

function dbPath(): string {
  return path.join(runtimeRoot(), 'store.sqlite');
}

function initSchema(handle: Database.Database): void {
  handle.pragma('journal_mode = WAL');
  handle.pragma('synchronous = NORMAL');
  handle.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      task TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      embedding TEXT,
      links TEXT NOT NULL DEFAULT '[]',
      provenance TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_created_idx ON memory(created_at DESC);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_created_idx ON runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playbooks (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS singletons (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS installed_skills (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    );
  `);
}

export function getDb(): Database.Database {
  const dir = runtimeRoot();
  if (cached && cached.dir === dir) return cached.handle;
  if (cached) {
    try { cached.handle.close(); } catch { /* ignore */ }
  }
  fs.ensureDirSync(dir);
  const handle = new Database(dbPath());
  initSchema(handle);
  cached = { handle, dir };
  return handle;
}

export function closeDb(): void {
  if (!cached) return;
  try { cached.handle.close(); } catch { /* ignore */ }
  cached = null;
}

export function getSingleton(key: string): unknown {
  const row = getDb().prepare('SELECT value FROM singletons WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function setSingleton(key: string, value: unknown): void {
  const text = JSON.stringify(value);
  getDb().prepare('INSERT INTO singletons (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, text);
}

export function withTx<T>(fn: () => T): T {
  const db = getDb();
  const transaction = db.transaction(fn);
  return transaction();
}

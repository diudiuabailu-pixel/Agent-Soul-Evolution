import { createHash } from 'node:crypto';
import { getDb } from './db.js';
import { loadMemory } from './storage.js';
import type { MemoryItem, MemoryProvenance } from '../types.js';

const SIGN_SALT = process.env.ASE_GOVERNANCE_SALT ?? 'agent-soul-evolution/v1';

export function signMemory(item: Pick<MemoryItem, 'id' | 'kind' | 'task' | 'content'>): string {
  return createHash('sha256')
    .update(`${SIGN_SALT}|${item.id}|${item.kind}|${item.task}|${item.content}`)
    .digest('hex');
}

export function makeProvenance(item: Pick<MemoryItem, 'id' | 'kind' | 'task' | 'content'>, source: string): MemoryProvenance {
  return {
    source,
    signature: signMemory(item),
    signedAt: new Date().toISOString()
  };
}

export type ProvenanceAudit = {
  total: number;
  signed: number;
  unsigned: number;
  tampered: Array<{ id: string; expected: string; actual?: string }>;
};

export async function auditMemoryProvenance(): Promise<ProvenanceAudit> {
  const items = await loadMemory();
  const audit: ProvenanceAudit = { total: items.length, signed: 0, unsigned: 0, tampered: [] };
  for (const item of items) {
    if (!item.provenance) {
      audit.unsigned += 1;
      continue;
    }
    const expected = signMemory(item);
    if (expected === item.provenance.signature) {
      audit.signed += 1;
    } else {
      audit.tampered.push({ id: item.id, expected, actual: item.provenance.signature });
    }
  }
  return audit;
}

export async function backfillProvenance(source = 'backfill'): Promise<number> {
  const items = await loadMemory();
  const db = getDb();
  const update = db.prepare('UPDATE memory SET provenance = ? WHERE id = ?');
  let touched = 0;
  for (const item of items) {
    if (item.provenance) continue;
    const provenance = makeProvenance(item, source);
    update.run(JSON.stringify(provenance), item.id);
    touched += 1;
  }
  return touched;
}

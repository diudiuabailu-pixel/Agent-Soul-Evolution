import type { MemoryItem } from '../types.js';

export type MemoryOpStore = {
  kind: 'store';
  memoryKind: 'lesson' | 'insight' | 'result' | 'reflection';
  content: string;
  importance?: number;
  tags: string[];
};

export type MemoryOpBoost = {
  kind: 'boost';
  id: string;
  delta: number;
};

export type MemoryOpDiscard = {
  kind: 'discard';
  id: string;
};

export type MemoryOpMerge = {
  kind: 'merge';
  ids: string[];
};

export type MemoryOpRetrieve = {
  kind: 'retrieve';
  query: string;
  k: number;
};

export type MemoryOp =
  | MemoryOpStore
  | MemoryOpBoost
  | MemoryOpDiscard
  | MemoryOpMerge
  | MemoryOpRetrieve;

export type ParseResult = {
  cleaned: string;
  ops: MemoryOp[];
};

const TAG_PATTERN = /<memory:(store|retrieve|boost|discard|merge)\b([^>]*)>([\s\S]*?)<\/memory:\1>|<memory:(boost|discard)\b([^>]*)\/>/gi;

function parseAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    out[match[1].toLowerCase()] = match[2];
  }
  return out;
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);
}

function clampImportance(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function parseMemoryOps(text: string): ParseResult {
  if (!text || !text.includes('<memory:')) return { cleaned: text, ops: [] };
  const ops: MemoryOp[] = [];
  const cleaned = text.replace(TAG_PATTERN, (_match, opPaired, attrsPaired, body, opSelf, attrsSelf) => {
    const op = (opPaired || opSelf || '').toLowerCase();
    const rawAttrs = attrsPaired || attrsSelf || '';
    const attrs = parseAttributes(rawAttrs);
    const inner = (body ?? '').trim();

    if (op === 'store') {
      const memoryKind = (attrs.kind || 'lesson') as MemoryOpStore['memoryKind'];
      const allowed = new Set(['lesson', 'insight', 'result', 'reflection']);
      ops.push({
        kind: 'store',
        memoryKind: allowed.has(memoryKind) ? memoryKind : 'lesson',
        content: inner,
        importance: clampImportance(Number(attrs.importance)),
        tags: parseTags(attrs.tags)
      });
      return '';
    }
    if (op === 'retrieve') {
      const k = Number(attrs.k);
      ops.push({
        kind: 'retrieve',
        query: inner || attrs.query || '',
        k: Number.isFinite(k) ? Math.max(1, Math.min(20, Math.round(k))) : 5
      });
      return '';
    }
    if (op === 'boost') {
      const id = attrs.id?.trim();
      if (!id) return '';
      const delta = Number(attrs.delta ?? inner) || 1;
      ops.push({ kind: 'boost', id, delta: Math.max(-10, Math.min(10, Math.round(delta))) });
      return '';
    }
    if (op === 'discard') {
      const id = attrs.id?.trim();
      if (!id) return '';
      ops.push({ kind: 'discard', id });
      return '';
    }
    if (op === 'merge') {
      const ids = (inner || attrs.ids || '').split(/[,\s]+/).map((entry: string) => entry.trim()).filter(Boolean);
      if (ids.length >= 2) ops.push({ kind: 'merge', ids });
      return '';
    }
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();

  return { cleaned, ops };
}

export function memoryOpProtocolHelp(): string {
  return [
    'Memory tools (optional, place anywhere in your output):',
    '<memory:store kind="lesson" importance="7" tags="workspace">Concrete reusable rule.</memory:store>',
    '<memory:retrieve k="5">workspace inspection</memory:retrieve>',
    '<memory:boost id="abc" delta="2"/>',
    '<memory:discard id="abc"/>',
    '<memory:merge>id1,id2</memory:merge>'
  ].join('\n');
}

export function summarizeOps(ops: MemoryOp[]): string {
  if (ops.length === 0) return 'no memory ops';
  return ops.map((op) => {
    switch (op.kind) {
      case 'store': return `store(${op.memoryKind}, i=${op.importance ?? 'auto'}, "${op.content.slice(0, 40)}")`;
      case 'retrieve': return `retrieve(k=${op.k}, "${op.query.slice(0, 40)}")`;
      case 'boost': return `boost(${op.id.slice(0, 8)}, ${op.delta})`;
      case 'discard': return `discard(${op.id.slice(0, 8)})`;
      case 'merge': return `merge(${op.ids.length} ids)`;
    }
  }).join('; ');
}

export function describeMemoryItemForOps(item: MemoryItem): string {
  return `${item.id}|${item.kind}|i=${item.importance}|${item.content.slice(0, 80)}`;
}

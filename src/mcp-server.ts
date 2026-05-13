import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  appendMemory,
  deleteMemory,
  loadInsights,
  loadMemory,
  loadPlaybooks,
  loadRuns,
  loadSoulProfile,
  mergeMemories,
  saveInsights,
  savePlaybooks,
  saveSoulProfile,
  updateMemoryImportance
} from './runtime/storage.js';
import { runTask } from './runtime/engine.js';
import { loadConfig } from './runtime/storage.js';
import { retrieveMemories } from './runtime/memory.js';
import { deriveCandidateInsights, reconcileInsights } from './runtime/insights.js';
import { deriveCandidatePlaybooks, reconcilePlaybooks } from './runtime/playbooks.js';
import { recordEvolution, refreshIdentity, summarizeSoul } from './runtime/soul.js';
import { loadAgent } from './runtime/storage.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

function textResult(payload: unknown, structured?: Record<string, unknown>): ToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured ?? (typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : undefined)
  };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'agent-soul-evolution', version: '0.2.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.registerTool(
    'memory_store',
    {
      title: 'Store a memory item',
      description: 'Persist a lesson, insight, result, or reflection into the soul memory store. Returns the new memory id and importance.',
      inputSchema: {
        kind: z.enum(['lesson', 'insight', 'result', 'reflection']).describe('Memory kind'),
        task: z.string().describe('Task the memory came from'),
        content: z.string().describe('Memory body'),
        importance: z.number().int().min(1).max(10).optional().describe('Optional importance score 1-10'),
        tags: z.array(z.string()).optional().describe('Optional tags')
      }
    },
    async (args) => {
      const stored = await appendMemory({
        kind: args.kind,
        task: args.task,
        content: args.content,
        tags: args.tags ?? [],
        importance: args.importance
      });
      return textResult({ id: stored.id, importance: stored.importance });
    }
  );

  server.registerTool(
    'memory_retrieve',
    {
      title: 'Retrieve top-k relevant memories',
      description: 'Search the memory store using a weighted recency × importance × relevance score. Optionally filter by kind.',
      inputSchema: {
        query: z.string().describe('Query text'),
        k: z.number().int().min(1).max(50).optional().describe('Max items to return (default 5)'),
        kind: z.enum(['lesson', 'insight', 'result', 'reflection']).optional()
      }
    },
    async (args) => {
      const [items, config] = await Promise.all([loadMemory(), loadConfig()]);
      const filtered = args.kind ? items.filter((item) => item.kind === args.kind) : items;
      const scored = retrieveMemories(filtered, args.query, args.k ?? 5, config);
      return textResult({
        items: scored.map((entry) => ({
          id: entry.item.id,
          kind: entry.item.kind,
          importance: entry.item.importance,
          content: entry.item.content,
          tags: entry.item.tags,
          score: Number(entry.score.toFixed(3)),
          components: {
            recency: Number(entry.components.recency.toFixed(3)),
            importance: Number(entry.components.importance.toFixed(3)),
            relevance: Number(entry.components.relevance.toFixed(3))
          }
        }))
      });
    }
  );

  server.registerTool(
    'memory_boost',
    {
      title: 'Adjust a memory item importance',
      description: 'Add or subtract from the importance score of a single memory id (clamped to 1..10).',
      inputSchema: {
        id: z.string().describe('Memory id'),
        delta: z.number().int().min(-10).max(10).describe('Importance change')
      }
    },
    async (args) => {
      const memories = await loadMemory();
      const target = memories.find((item) => item.id === args.id);
      if (!target) return errorResult(`No memory with id ${args.id}`);
      const next = Math.max(1, Math.min(10, target.importance + args.delta));
      await updateMemoryImportance(args.id, next);
      return textResult({ id: args.id, importance: next });
    }
  );

  server.registerTool(
    'memory_discard',
    {
      title: 'Delete a memory item',
      description: 'Remove a memory by id. Also removes incoming A-Mem links from peers.',
      inputSchema: {
        id: z.string().describe('Memory id')
      }
    },
    async (args) => {
      const deleted = await deleteMemory(args.id);
      return textResult({ id: args.id, deleted });
    }
  );

  server.registerTool(
    'memory_merge',
    {
      title: 'Merge several memory items',
      description: 'Merge two or more memories of the same kind into the most-important survivor; tail items are removed.',
      inputSchema: {
        ids: z.array(z.string()).min(2).describe('Memory ids to merge (at least 2)')
      }
    },
    async (args) => {
      const result = await mergeMemories(args.ids);
      return textResult(result);
    }
  );

  server.registerTool(
    'run_task',
    {
      title: 'Run a task through the runtime',
      description: 'Execute a task end-to-end (model + skills + reflection + checker + soul update). Returns the persisted run record.',
      inputSchema: {
        task: z.string().describe('Task description for the agent')
      }
    },
    async (args) => {
      const run = await runTask(args.task);
      return textResult({
        id: run.id,
        status: run.status,
        attempts: run.attempts,
        usedSkills: run.usedSkills,
        firstAttemptSucceeded: run.firstAttemptSucceeded,
        checkerVerdict: run.checkerVerdict,
        output: run.output,
        reflection: run.reflection
      });
    }
  );

  server.registerTool(
    'soul_status',
    {
      title: 'Read the current soul profile',
      description: 'Return the soul profile plus a one-line summary (runs, success rate, retry uplift, generations).',
      inputSchema: {}
    },
    async () => {
      const soul = await loadSoulProfile();
      return textResult({ soul, summary: summarizeSoul(soul) });
    }
  );

  server.registerTool(
    'soul_evolve',
    {
      title: 'Trigger an evolution cycle',
      description: 'Run an insight extraction cycle over recent runs, reconcile with existing insights, and refresh the soul identity.',
      inputSchema: {}
    },
    async () => {
      const [runs, existing, profile, agent] = await Promise.all([
        loadRuns(),
        loadInsights(),
        loadSoulProfile(),
        loadAgent()
      ]);
      const candidates = deriveCandidateInsights(runs.slice(0, 20));
      const { next, ops } = reconcileInsights(existing, candidates);
      await saveInsights(next);
      const evolved = recordEvolution(profile);
      const refreshed = refreshIdentity(evolved, agent, next);
      await saveSoulProfile(refreshed);
      return textResult({
        operations: ops,
        insightsCount: next.length,
        soul: { generations: refreshed.generations, summary: summarizeSoul(refreshed) }
      });
    }
  );

  server.registerTool(
    'playbooks_list',
    {
      title: 'List synthesized playbooks',
      description: 'Return the active playbooks sorted by support × success rate.',
      inputSchema: {}
    },
    async () => {
      const playbooks = await loadPlaybooks();
      return textResult({ playbooks });
    }
  );

  server.registerTool(
    'playbooks_synthesize',
    {
      title: 'Synthesize playbooks from recent runs',
      description: 'Cluster recent successful runs by task similarity, derive new playbooks, and reconcile with existing ones.',
      inputSchema: {}
    },
    async () => {
      const [runs, existing] = await Promise.all([loadRuns(), loadPlaybooks()]);
      const candidates = deriveCandidatePlaybooks(runs.slice(0, 60));
      const next = reconcilePlaybooks(existing, candidates);
      await savePlaybooks(next);
      return textResult({ added: next.length - existing.length, playbooks: next });
    }
  );

  server.registerResource(
    'soul-profile',
    'agent-soul://soul/profile',
    {
      title: 'Soul profile',
      description: 'Current soul identity, success rate, retry uplift, generations, and per-skill stats.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const soul = await loadSoulProfile();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(soul, null, 2)
        }]
      };
    }
  );

  server.registerResource(
    'top-insights',
    'agent-soul://insights/top',
    {
      title: 'Top insights',
      description: 'Consolidated insights ranked by support × confidence.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const insights = await loadInsights();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(insights, null, 2)
        }]
      };
    }
  );

  server.registerResource(
    'active-playbooks',
    'agent-soul://playbooks/active',
    {
      title: 'Active playbooks',
      description: 'Synthesized playbooks with triggers, suggested skills, support and success rate.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const playbooks = await loadPlaybooks();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(playbooks, null, 2)
        }]
      };
    }
  );

  server.registerResource(
    'recent-memory',
    'agent-soul://memory/recent',
    {
      title: 'Recent memory items',
      description: 'Up to 50 most recently created or accessed memory items.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const items = await loadMemory();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(items.slice(0, 50), null, 2)
        }]
      };
    }
  );

  server.registerResource(
    'recent-runs',
    'agent-soul://runs/recent',
    {
      title: 'Recent runs',
      description: 'Up to 50 most recent run records with trajectory and applied memory ops.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const runs = await loadRuns();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(runs.slice(0, 50), null, 2)
        }]
      };
    }
  );

  return server;
}

export async function startMcpStdioServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

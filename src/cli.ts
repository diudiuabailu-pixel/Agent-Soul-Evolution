import { Command } from 'commander';
import open from 'open';
import {
  ensureRuntime,
  installSkill,
  loadConfig,
  loadInsights,
  loadInstalledSkills,
  loadMemory,
  loadPlaybooks,
  loadRuns,
  loadSoulProfile,
  loadAgent,
  saveConfig,
  saveInsights,
  savePlaybooks,
  saveSoulProfile
} from './runtime/storage.js';
import { getSkillManifest } from './skills/catalog.js';
import { loadAllSkillManifests, installSkillPackage } from './runtime/discovery.js';
import { runEvalSuite } from './runtime/eval.js';
import { listOllamaModels } from './runtime/ollama.js';
import { createServer } from './server.js';
import { runTask } from './runtime/engine.js';
import { deriveCandidateInsights, reconcileInsights } from './runtime/insights.js';
import { deriveCandidatePlaybooks, reconcilePlaybooks } from './runtime/playbooks.js';
import { recordEvolution, refreshIdentity, summarizeSoul } from './runtime/soul.js';
import { consolidateMemory } from './runtime/memory.js';

const program = new Command();
program.name('ase').description('Agent Soul Evolution local runtime').version('0.2.0');

program.command('init').description('Initialize local runtime files').action(async () => {
  await ensureRuntime();
  console.log('Runtime initialized in ./.runtime');
});

program.command('doctor').description('Check local runtime status').action(async () => {
  await ensureRuntime();
  const config = await loadConfig();
  const installed = await loadInstalledSkills();
  const soul = await loadSoulProfile();
  console.log(`Runtime: ready`);
  console.log(`Port: ${config.server.port}`);
  console.log(`Default model: ${config.models.default.model}`);
  console.log(`Base URL: ${config.models.default.baseUrl}`);
  console.log(`Installed skills: ${installed.join(', ')}`);
  console.log(`Soul: ${summarizeSoul(soul)}`);
});

const skill = program.command('skill').description('Manage skills');

skill.command('list').action(async () => {
  const skills = await loadAllSkillManifests();
  for (const item of skills) {
    console.log(`${item.id} - ${item.description}`);
  }
});

skill.command('add').argument('<id>').action(async (id: string) => {
  const manifest = getSkillManifest(id);
  if (!manifest) {
    console.error(`Unknown skill: ${id}`);
    process.exit(1);
  }
  await installSkill(id);
  console.log(`Installed skill: ${id}`);
});

skill.command('install-path').argument('<dir>').action(async (dir: string) => {
  const manifest = await installSkillPackage(dir);
  await installSkill(manifest.id);
  console.log(`Installed skill package: ${manifest.id}`);
});

program.command('ollama:list').description('List local Ollama models').action(async () => {
  try {
    const models = await listOllamaModels();
    if (models.length === 0) {
      console.log('No Ollama models found.');
      return;
    }
    for (const model of models) {
      console.log(`${model.name}${model.modified_at ? ` - ${model.modified_at}` : ''}`);
    }
  } catch (error) {
    console.log(`Ollama is not reachable: ${error instanceof Error ? error.message : String(error)}`);
  }
});

program.command('config:set-model')
  .description('Set the default model endpoint and model name')
  .requiredOption('--base-url <url>')
  .requiredOption('--model <name>')
  .action(async (options) => {
    const config = await loadConfig();
    config.models.default.baseUrl = options.baseUrl;
    config.models.default.model = options.model;
    await saveConfig(config);
    console.log(`Updated model to ${options.model} at ${options.baseUrl}`);
  });

program.command('run')
  .description('Run a single task through the runtime')
  .argument('<task...>')
  .option('--json', 'Print the full run record as JSON')
  .action(async (taskParts: string[], options: { json?: boolean }) => {
    const task = taskParts.join(' ').trim();
    if (!task) {
      console.error('Task is required.');
      process.exit(1);
    }
    const run = await runTask(task);
    if (options.json) {
      console.log(JSON.stringify(run, null, 2));
      return;
    }
    console.log(`Run ${run.id} (${run.status}, attempts=${run.attempts})`);
    console.log(`Skills: ${run.usedSkills.join(', ') || 'none'}`);
    if (run.appliedInsightIds && run.appliedInsightIds.length > 0) {
      console.log(`Applied insights: ${run.appliedInsightIds.length}`);
    }
    if (run.retrievedMemoryIds && run.retrievedMemoryIds.length > 0) {
      console.log(`Recalled memories: ${run.retrievedMemoryIds.length}`);
    }
    console.log('---');
    console.log(run.output);
    console.log('---');
    console.log(`Reflection: ${run.reflection}`);
  });

program.command('memory:list')
  .description('Print recent memory items')
  .option('-n, --limit <n>', 'Max items to show', '10')
  .action(async (options: { limit?: string }) => {
    const items = await loadMemory();
    const limit = Math.max(1, Number(options.limit || 10));
    for (const item of items.slice(0, limit)) {
      console.log(`[${item.kind}] i=${item.importance} acc=${item.accessCount} ${item.createdAt}`);
      console.log(`  task: ${item.task.slice(0, 120)}`);
      console.log(`  ${item.content.slice(0, 200)}`);
    }
  });

program.command('runs:list')
  .description('Print recent run records')
  .option('-n, --limit <n>', 'Max runs to show', '10')
  .action(async (options: { limit?: string }) => {
    const runs = await loadRuns();
    const limit = Math.max(1, Number(options.limit || 10));
    for (const run of runs.slice(0, limit)) {
      console.log(`${run.id} ${run.status} attempts=${run.attempts} ${run.createdAt}`);
      console.log(`  task: ${run.task.slice(0, 120)}`);
      console.log(`  skills: ${run.usedSkills.join(', ') || 'none'}`);
    }
  });

program.command('memory:consolidate')
  .description('Merge highly similar memories to compress long-term store')
  .action(async () => {
    const items = await loadMemory();
    const result = consolidateMemory(items);
    if (result.merged === 0) {
      console.log('No memories were merged.');
      return;
    }
    const { saveMemoryItems } = await import('./runtime/storage.js');
    await saveMemoryItems(result.items);
    console.log(`Merged ${result.merged} memory item(s); now ${result.items.length} stored.`);
  });

program.command('eval').description('Run the default evaluation suite').action(async () => {
  const result = await runEvalSuite();
  console.log(`Passed ${result.passed}/${result.total}`);
  for (const item of result.results) {
    console.log(`- ${item.name}: ${item.passed ? 'PASS' : 'FAIL'}${item.matched.length ? ` (${item.matched.join(', ')})` : ''}`);
  }
});

program.command('soul').description('Show the current soul profile and top insights').action(async () => {
  const [soul, insights] = await Promise.all([loadSoulProfile(), loadInsights()]);
  console.log(summarizeSoul(soul));
  if (soul.identity) {
    console.log('---');
    console.log(soul.identity);
  }
  if (insights.length > 0) {
    console.log('---');
    console.log('Top insights:');
    for (const insight of insights.slice(0, 5)) {
      console.log(`- (s=${insight.support} c=${insight.confidence.toFixed(2)}) ${insight.content}`);
    }
  }
});

program.command('playbooks:list').description('Print synthesized playbooks').action(async () => {
  const playbooks = await loadPlaybooks();
  if (playbooks.length === 0) {
    console.log('No playbooks synthesized yet.');
    return;
  }
  for (const entry of playbooks) {
    console.log(`${entry.id} support=${entry.support} success=${(entry.successRate * 100).toFixed(0)}%`);
    console.log(`  ${entry.title}`);
    console.log(`  trigger: ${entry.trigger || '(none)'}`);
    console.log(`  skills: ${entry.suggestedSkills.join(', ') || 'none'}`);
  }
});

program.command('playbooks:synthesize').description('Run a playbook synthesis cycle over recent runs').action(async () => {
  const [runs, existing] = await Promise.all([loadRuns(), loadPlaybooks()]);
  const candidates = deriveCandidatePlaybooks(runs.slice(0, 60));
  const next = reconcilePlaybooks(existing, candidates);
  await savePlaybooks(next);
  const delta = next.length - existing.length;
  console.log(`Playbooks: now ${next.length} stored (${delta >= 0 ? '+' : ''}${delta} from this cycle).`);
  for (const playbook of next.slice(0, 5)) {
    console.log(`- ${playbook.title} (s=${playbook.support}, success=${(playbook.successRate * 100).toFixed(0)}%)`);
  }
});

program.command('soul:evolve').description('Run an insight extraction cycle over recent runs').action(async () => {
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
  console.log(`Evolution cycle ${refreshed.generations} complete. ${ops.length} operation(s).`);
  for (const op of ops) {
    if (op.kind === 'add') console.log(`+ ADD: ${op.insight.content}`);
    if (op.kind === 'upvote') console.log(`^ UPVOTE: ${op.id}`);
    if (op.kind === 'downvote') console.log(`v DOWNVOTE: ${op.id}`);
    if (op.kind === 'edit') console.log(`~ EDIT: ${op.id}`);
  }
});

program.command('start').description('Start local runtime and open the web console').action(async () => {
  await ensureRuntime();
  const { app, port } = await createServer();
  app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.log(`Agent Soul Evolution running on ${url}`);
    await open(url);
  });
});

program.parseAsync(process.argv);

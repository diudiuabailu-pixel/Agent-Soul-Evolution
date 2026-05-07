import { Command } from 'commander';
import open from 'open';
import {
  ensureRuntime,
  installSkill,
  loadConfig,
  loadInsights,
  loadInstalledSkills,
  loadRuns,
  loadSoulProfile,
  loadAgent,
  saveConfig,
  saveInsights,
  saveSoulProfile
} from './runtime/storage.js';
import { getSkillManifest } from './skills/catalog.js';
import { loadAllSkillManifests, installSkillPackage } from './runtime/discovery.js';
import { runEvalSuite } from './runtime/eval.js';
import { listOllamaModels } from './runtime/ollama.js';
import { createServer } from './server.js';
import { deriveCandidateInsights, reconcileInsights } from './runtime/insights.js';
import { recordEvolution, refreshIdentity, summarizeSoul } from './runtime/soul.js';

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

import { Command } from 'commander';
import open from 'open';
import { ensureRuntime, installSkill, loadConfig, loadInstalledSkills, saveConfig } from './runtime/storage.js';
import { skillCatalog, getSkillManifest } from './skills/catalog.js';
import { createServer } from './server.js';

const program = new Command();
program.name('ase').description('Agent Soul Evolution local runtime').version('0.1.0');

program.command('init').description('Initialize local runtime files').action(async () => {
  await ensureRuntime();
  console.log('Runtime initialized in ./.runtime');
});

program.command('doctor').description('Check local runtime status').action(async () => {
  await ensureRuntime();
  const config = await loadConfig();
  const installed = await loadInstalledSkills();
  console.log(`Runtime: ready`);
  console.log(`Port: ${config.server.port}`);
  console.log(`Default model: ${config.models.default.model}`);
  console.log(`Base URL: ${config.models.default.baseUrl}`);
  console.log(`Installed skills: ${installed.join(', ')}`);
});

const skill = program.command('skill').description('Manage skills');

skill.command('list').action(() => {
  for (const item of skillCatalog) {
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

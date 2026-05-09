import path from 'node:path';

export function projectRoot(): string {
  return process.cwd();
}

export function runtimeRoot(): string {
  return path.join(projectRoot(), '.runtime');
}

export function configPath(): string {
  return path.join(runtimeRoot(), 'config.yaml');
}

export function memoryPath(): string {
  return path.join(runtimeRoot(), 'memory', 'items.json');
}

export function runsPath(): string {
  return path.join(runtimeRoot(), 'runs', 'items.json');
}

export function agentsPath(): string {
  return path.join(runtimeRoot(), 'agents', 'default.json');
}

export function installedSkillsPath(): string {
  return path.join(runtimeRoot(), 'skills', 'installed.json');
}

export function skillPackagesRoot(): string {
  return path.join(runtimeRoot(), 'skills', 'packages');
}

export function soulRoot(): string {
  return path.join(runtimeRoot(), 'soul');
}

export function insightsPath(): string {
  return path.join(soulRoot(), 'insights.json');
}

export function soulProfilePath(): string {
  return path.join(soulRoot(), 'profile.json');
}

export function embeddingsCachePath(): string {
  return path.join(runtimeRoot(), 'memory', 'embeddings.json');
}

export function playbooksPath(): string {
  return path.join(soulRoot(), 'playbooks.json');
}

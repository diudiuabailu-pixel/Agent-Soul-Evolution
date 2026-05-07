import path from 'node:path';

export const projectRoot = process.cwd();
export const runtimeRoot = path.join(projectRoot, '.runtime');
export const configPath = path.join(runtimeRoot, 'config.yaml');
export const memoryPath = path.join(runtimeRoot, 'memory', 'items.json');
export const runsPath = path.join(runtimeRoot, 'runs', 'items.json');
export const agentsPath = path.join(runtimeRoot, 'agents', 'default.json');
export const installedSkillsPath = path.join(runtimeRoot, 'skills', 'installed.json');
export const skillPackagesRoot = path.join(runtimeRoot, 'skills', 'packages');

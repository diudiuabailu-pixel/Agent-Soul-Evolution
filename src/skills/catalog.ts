import type { SkillManifest } from '../types.js';

export const skillCatalog: SkillManifest[] = [
  {
    id: 'file-browser',
    name: 'File Browser',
    description: 'Read local directories and inspect files inside the current workspace.',
    entry: 'builtin:file-browser'
  },
  {
    id: 'web-fetch',
    name: 'Web Fetch',
    description: 'Fetch public pages through HTTP and return readable text.',
    entry: 'builtin:web-fetch'
  },
  {
    id: 'shell-command',
    name: 'Shell Command',
    description: 'Run local shell commands in the workspace with explicit invocation.',
    entry: 'builtin:shell-command'
  }
];

export function getSkillManifest(id: string): SkillManifest | undefined {
  return skillCatalog.find((item) => item.id === id);
}

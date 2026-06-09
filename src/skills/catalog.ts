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
  },
  {
    id: 'note-taker',
    name: 'Note Taker',
    description: 'Capture a short note in local notes storage without polluting agent memory.',
    entry: 'builtin:note-taker'
  },
  {
    id: 'code-edit',
    name: 'Code Edit',
    description: 'Preview safe file edits inside the workspace. Returns a diff plan; the agent applies it explicitly.',
    entry: 'builtin:code-edit'
  },
  {
    id: 'web-search',
    name: 'Web Search',
    description: 'Hit a configured search API (env ASE_SEARCH_URL) and return top snippets.',
    entry: 'builtin:web-search'
  }
];

export function getSkillManifest(id: string): SkillManifest | undefined {
  return skillCatalog.find((item) => item.id === id);
}

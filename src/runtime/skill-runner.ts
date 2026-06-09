import fs from 'fs-extra';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectRoot } from './paths.js';

const execFileAsync = promisify(execFile);

export type SkillExecution = {
  skillId: string;
  summary: string;
  output: string;
};

async function runFileBrowser(task: string): Promise<SkillExecution> {
  const names = await fs.readdir(projectRoot());
  const visible = names.filter((name) => !name.startsWith('.')).slice(0, 24);
  return {
    skillId: 'file-browser',
    summary: 'Scanned visible workspace entries.',
    output: [`Task: ${task}`, 'Workspace entries:', ...visible.map((name) => `- ${name}`)].join('\n')
  };
}

async function runWebFetch(task: string): Promise<SkillExecution> {
  const match = task.match(/https?:\/\/\S+/i);
  if (!match) {
    return {
      skillId: 'web-fetch',
      summary: 'No URL found in task.',
      output: 'No URL was present in the task, so no web content was fetched.'
    };
  }

  const url = match[0];
  const response = await fetch(url);
  const html = await response.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  return {
    skillId: 'web-fetch',
    summary: `Fetched ${url}`,
    output: text || `Fetched ${url}, but no readable text was extracted.`
  };
}

async function runShellCommand(task: string): Promise<SkillExecution> {
  const commandMatch = task.match(/`([^`]+)`/);
  const raw = commandMatch?.[1]?.trim() || (task.toLowerCase().includes('pwd') ? 'pwd' : '');
  if (!raw) {
    return {
      skillId: 'shell-command',
      summary: 'No inline shell command found.',
      output: 'To execute a shell command, include it in backticks inside the task.'
    };
  }
  const [command, ...args] = raw.split(/\s+/);
  const allowed = new Set(['pwd', 'ls', 'cat', 'echo', 'git']);
  if (!allowed.has(command)) {
    return {
      skillId: 'shell-command',
      summary: `Command blocked: ${command}`,
      output: `The command \`${command}\` is not in the safe allowlist.`
    };
  }

  const { stdout, stderr } = await execFileAsync(command, args, { cwd: projectRoot(), timeout: 10000 });
  return {
    skillId: 'shell-command',
    summary: `Executed ${raw}`,
    output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || 'Command completed with no output.'
  };
}

async function runNoteTaker(task: string): Promise<SkillExecution> {
  const { getDb } = await import('./db.js');
  const match = task.match(/note[: -]+([\s\S]+)/i);
  const body = match ? match[1].trim() : task;
  if (!body) {
    return { skillId: 'note-taker', summary: 'No note text found.', output: 'Provide a note after `note:` or in the task body.' };
  }
  const id = Math.random().toString(36).slice(2, 10);
  const title = body.slice(0, 60);
  const createdAt = new Date().toISOString();
  getDb().prepare('INSERT INTO notes (id, title, body, created_at, tags) VALUES (?, ?, ?, ?, ?)').run(id, title, body, createdAt, '[]');
  return {
    skillId: 'note-taker',
    summary: `Saved note ${id}.`,
    output: `Recorded note: ${title}\n(${body.length} characters at ${createdAt})`
  };
}

async function runCodeEdit(task: string): Promise<SkillExecution> {
  const planMatch = task.match(/edit\s+`([^`]+)`/i);
  const replaceMatch = task.match(/replace\s+`([^`]+)`\s+with\s+`([^`]+)`/i);
  if (!planMatch || !replaceMatch) {
    return {
      skillId: 'code-edit',
      summary: 'Code edit needs file + replacement spec.',
      output: 'Format: `edit `path/to/file` replace `old text` with `new text``. The skill returns a preview only — the agent must apply changes via shell-command or a separate write step.'
    };
  }
  const target = planMatch[1];
  const oldText = replaceMatch[1];
  const newText = replaceMatch[2];
  if (target.includes('..') || path.isAbsolute(target)) {
    return { skillId: 'code-edit', summary: 'Refusing to edit outside workspace.', output: 'Edit paths must be workspace-relative and may not contain "..".' };
  }
  const full = path.join(projectRoot(), target);
  if (!(await fs.pathExists(full))) {
    return { skillId: 'code-edit', summary: 'File not found.', output: `No such file: ${target}` };
  }
  const original = await fs.readFile(full, 'utf8');
  if (!original.includes(oldText)) {
    return { skillId: 'code-edit', summary: 'old text not found.', output: `Could not find substring in ${target}.` };
  }
  const preview = original.replace(oldText, newText);
  const previewSnippet = preview.slice(0, 600);
  return {
    skillId: 'code-edit',
    summary: `Preview computed for ${target} (${original.length} → ${preview.length} chars).`,
    output: `Preview for ${target}:\n----\n${previewSnippet}${preview.length > 600 ? '\n...[truncated]' : ''}\n----\nThe change has not been applied. Confirm and persist via a follow-up action.`
  };
}

async function runWebSearch(task: string): Promise<SkillExecution> {
  const endpoint = process.env.ASE_SEARCH_URL;
  if (!endpoint) {
    return {
      skillId: 'web-search',
      summary: 'No ASE_SEARCH_URL configured.',
      output: 'Set ASE_SEARCH_URL (and optional ASE_SEARCH_TOKEN) to point at a JSON search API that accepts ?q=. The skill returns top snippets.'
    };
  }
  const url = new URL(endpoint);
  url.searchParams.set('q', task);
  const headers: Record<string, string> = {};
  if (process.env.ASE_SEARCH_TOKEN) headers.Authorization = `Bearer ${process.env.ASE_SEARCH_TOKEN}`;
  try {
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      return { skillId: 'web-search', summary: `Search endpoint returned ${response.status}.`, output: `HTTP ${response.status}` };
    }
    const data = await response.json() as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
    const results = (data.results ?? []).slice(0, 5);
    if (results.length === 0) {
      return { skillId: 'web-search', summary: 'No search results.', output: `No hits for: ${task}` };
    }
    const formatted = results.map((entry, idx) => `${idx + 1}. ${entry.title ?? '(no title)'}\n   ${entry.url ?? ''}\n   ${entry.snippet ?? ''}`).join('\n\n');
    return { skillId: 'web-search', summary: `Found ${results.length} results.`, output: formatted };
  } catch (error) {
    return { skillId: 'web-search', summary: 'Search request failed.', output: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeSkill(skillId: string, task: string): Promise<SkillExecution> {
  if (skillId === 'file-browser') return runFileBrowser(task);
  if (skillId === 'web-fetch') return runWebFetch(task);
  if (skillId === 'shell-command') return runShellCommand(task);
  if (skillId === 'note-taker') return runNoteTaker(task);
  if (skillId === 'code-edit') return runCodeEdit(task);
  if (skillId === 'web-search') return runWebSearch(task);

  return {
    skillId,
    summary: `No runtime handler registered for ${skillId}.`,
    output: 'This skill is installed but does not yet have an executable runtime handler.'
  };
}

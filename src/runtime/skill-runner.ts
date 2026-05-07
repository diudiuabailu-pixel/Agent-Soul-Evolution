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
  const names = await fs.readdir(projectRoot);
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

  const { stdout, stderr } = await execFileAsync(command, args, { cwd: projectRoot, timeout: 10000 });
  return {
    skillId: 'shell-command',
    summary: `Executed ${raw}`,
    output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || 'Command completed with no output.'
  };
}

export async function executeSkill(skillId: string, task: string): Promise<SkillExecution> {
  if (skillId === 'file-browser') return runFileBrowser(task);
  if (skillId === 'web-fetch') return runWebFetch(task);
  if (skillId === 'shell-command') return runShellCommand(task);

  return {
    skillId,
    summary: `No runtime handler registered for ${skillId}.`,
    output: 'This skill is installed but does not yet have an executable runtime handler.'
  };
}

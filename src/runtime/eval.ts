import fs from 'fs-extra';
import { runTask } from './engine.js';
import type { EvalCase } from '../types.js';

export type EvalResult = {
  name: string;
  passed: boolean;
  output: string;
  matched: string[];
  attempts: number;
  reflectionSuccess: boolean;
};

export const defaultEvalSuite: EvalCase[] = [
  {
    name: 'file visibility',
    task: 'List the visible workspace files and suggest the next step.',
    expectsAny: ['Workspace', 'workspace', 'file-browser']
  },
  {
    name: 'shell guidance',
    task: 'Run `pwd` and summarize the current working directory.',
    expectsAny: ['pwd', 'shell-command']
  },
  {
    name: 'memory grounding',
    task: 'Recall any prior lesson about file or shell tasks and apply it.',
    expectsAny: ['lesson', 'memory', 'recall', 'file-browser', 'shell-command']
  }
];

export async function loadEvalSuiteFromFile(filePath: string): Promise<EvalCase[]> {
  if (!(await fs.pathExists(filePath))) throw new Error(`No eval file at ${filePath}`);
  const raw = (await fs.readJson(filePath)) as unknown;
  if (!Array.isArray(raw)) throw new Error('Eval file must be a JSON array of {name, task, expectsAny}.');
  return raw
    .filter((entry) => entry && typeof entry === 'object' && typeof (entry as EvalCase).task === 'string')
    .map((entry) => ({
      name: String((entry as EvalCase).name ?? 'unnamed'),
      task: String((entry as EvalCase).task),
      expectsAny: Array.isArray((entry as EvalCase).expectsAny) ? (entry as EvalCase).expectsAny.map(String) : []
    }));
}

export async function runEvalSuite(extraCases: EvalCase[] = []): Promise<{ passed: number; total: number; results: EvalResult[]; successRate: number }> {
  const cases = [...defaultEvalSuite, ...extraCases];
  const results: EvalResult[] = [];

  for (const testCase of cases) {
    const run = await runTask(testCase.task);
    const matched = testCase.expectsAny.filter((token) => run.output.includes(token) || run.reflection.includes(token));
    results.push({
      name: testCase.name,
      passed: matched.length > 0,
      output: run.output,
      matched,
      attempts: run.attempts,
      reflectionSuccess: run.reflectionDetail?.success ?? run.status === 'completed'
    });
  }

  const passed = results.filter((item) => item.passed).length;
  return {
    passed,
    total: results.length,
    results,
    successRate: results.length > 0 ? passed / results.length : 0
  };
}

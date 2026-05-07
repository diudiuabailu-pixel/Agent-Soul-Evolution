import { runTask } from './engine.js';

export type EvalCase = {
  name: string;
  task: string;
  expectsAny: string[];
};

export type EvalResult = {
  name: string;
  passed: boolean;
  output: string;
  matched: string[];
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
    expectsAny: ['pwd', '/Users/', 'shell-command']
  }
];

export async function runEvalSuite(): Promise<{ passed: number; total: number; results: EvalResult[] }> {
  const results: EvalResult[] = [];

  for (const testCase of defaultEvalSuite) {
    const run = await runTask(testCase.task);
    const matched = testCase.expectsAny.filter((token) => run.output.includes(token) || run.reflection.includes(token));
    results.push({
      name: testCase.name,
      passed: matched.length > 0,
      output: run.output,
      matched
    });
  }

  return {
    passed: results.filter((item) => item.passed).length,
    total: results.length,
    results
  };
}

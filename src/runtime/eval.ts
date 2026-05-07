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

export async function runEvalSuite(): Promise<{ passed: number; total: number; results: EvalResult[]; successRate: number }> {
  const results: EvalResult[] = [];

  for (const testCase of defaultEvalSuite) {
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

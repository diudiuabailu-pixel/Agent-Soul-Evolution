export type WorkflowStage = {
  id: string;
  name: string;
  description: string;
};

export const defaultWorkflow: WorkflowStage[] = [
  {
    id: 'intake',
    name: 'Intake',
    description: 'Read the task, classify the request, and match it to available skills.'
  },
  {
    id: 'memory',
    name: 'Memory Recall',
    description: 'Search stored results and reflections for relevant prior context.'
  },
  {
    id: 'execution',
    name: 'Execution Plan',
    description: 'Suggest the shortest path, required skills, and final answer format.'
  },
  {
    id: 'reflection',
    name: 'Reflection',
    description: 'Store the result, write a reflection, and save reusable lessons.'
  }
];

export type SkillManifest = {
  id: string;
  name: string;
  description: string;
  entry: string;
};

export type RuntimeConfig = {
  server: {
    port: number;
  };
  models: {
    default: {
      provider: string;
      baseUrl: string;
      model: string;
    };
  };
  skills: {
    enabled: string[];
  };
  memory: {
    maxItems: number;
  };
};

export type MemoryItem = {
  id: string;
  createdAt: string;
  kind: 'result' | 'reflection' | 'lesson';
  task: string;
  content: string;
  tags: string[];
};

export type RunRecord = {
  id: string;
  task: string;
  agent: string;
  createdAt: string;
  status: 'completed' | 'failed';
  output: string;
  reflection: string;
  usedSkills: string[];
};

export type AgentProfile = {
  id: string;
  name: string;
  goal: string;
  systemPrompt: string;
  preferredSkills: string[];
  outputStyle: string;
};

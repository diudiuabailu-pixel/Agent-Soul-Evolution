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
  evolution: {
    retryOnFailure: boolean;
    maxRetries: number;
    insightCadence: number;
    recencyHalfLifeHours: number;
    weightRecency: number;
    weightImportance: number;
    weightRelevance: number;
    useEmbeddings: boolean;
    useCheckerModel: boolean;
    consolidateOnEvolve: boolean;
  };
};

export type MemoryKind = 'result' | 'reflection' | 'lesson' | 'insight';

export type MemoryItem = {
  id: string;
  createdAt: string;
  kind: MemoryKind;
  task: string;
  content: string;
  tags: string[];
  importance: number;
  accessCount: number;
  lastAccessedAt: string;
  embedding?: number[];
};

export type ReflectionResult = {
  success: boolean;
  observation: string;
  lesson: string;
  importance: number;
  signals: string[];
};

export type CheckerVerdict = {
  satisfied: boolean;
  confidence: number;
  reason: string;
  source: 'heuristic' | 'model';
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
  attempts: number;
  reflectionDetail?: ReflectionResult;
  retrievedMemoryIds?: string[];
  appliedInsightIds?: string[];
  checkerVerdict?: CheckerVerdict;
};

export type AgentProfile = {
  id: string;
  name: string;
  goal: string;
  systemPrompt: string;
  preferredSkills: string[];
  outputStyle: string;
};

export type Insight = {
  id: string;
  content: string;
  support: number;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  origins: string[];
  tags: string[];
};

export type SoulProfile = {
  runs: number;
  successes: number;
  failures: number;
  successRate: number;
  generations: number;
  identity: string;
  skillStats: Record<string, { used: number; succeeded: number }>;
  lastEvolvedAt: string | null;
  updatedAt: string;
};

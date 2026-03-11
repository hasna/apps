export interface Scenario {
  id: string;
  shortId: string;
  name: string;
  description: string;
  steps: string[];
  tags: string[];
  priority: string;
  model: string | null;
  timeoutMs: number | null;
  targetPath: string | null;
  requiresAuth: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  status: string;
  url: string;
  model: string;
  headed: boolean;
  parallel: number;
  total: number;
  passed: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface Result {
  id: string;
  runId: string;
  scenarioId: string;
  scenarioName: string | null;
  scenarioShortId: string | null;
  status: string;
  reasoning: string | null;
  error: string | null;
  stepsCompleted: number;
  stepsTotal: number;
  durationMs: number;
  model: string;
  tokensUsed: number;
  costCents: number;
  screenshots: ScreenshotRef[];
}

export interface ScreenshotRef {
  stepNumber: number;
  action: string;
  filePath: string;
}

export interface Screenshot {
  id: string;
  resultId: string;
  stepNumber: number;
  action: string;
  filePath: string;
  width: number;
  height: number;
  timestamp: string;
}

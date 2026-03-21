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
  personaId: string | null;
  personaName: string | null;
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

export interface Schedule {
  id: string;
  projectId: string | null;
  name: string;
  cronExpression: string;
  url: string;
  scenarioFilter: {
    tags?: string[];
    priority?: string;
    scenarioIds?: string[];
  };
  model: string | null;
  headed: boolean;
  parallel: number;
  timeoutMs: number | null;
  enabled: boolean;
  lastRunId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCheck {
  id: string;
  shortId: string;
  projectId: string | null;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  url: string;
  headers: Record<string, string>;
  body: string | null;
  expectedStatus: number;
  expectedBodyContains: string | null;
  expectedResponseTimeMs: number | null;
  timeoutMs: number;
  tags: string[];
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCheckResult {
  id: string;
  checkId: string;
  runId: string | null;
  status: "passed" | "failed" | "error";
  statusCode: number | null;
  responseTimeMs: number | null;
  responseBody: string | null;
  responseHeaders: Record<string, string>;
  error: string | null;
  assertionsPassed: string[];
  assertionsFailed: string[];
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  path: string | null;
  description: string | null;
  baseUrl: string | null;
  port: number | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  name: string;
  url: string;
  authPresetName: string | null;
  projectId: string | null;
  isDefault: boolean;
  variables: Record<string, string>;
  createdAt: string;
}

export interface Persona {
  id: string;
  shortId: string;
  projectId: string | null;
  name: string;
  description: string;
  role: string;
  instructions: string;
  traits: string[];
  goals: string[];
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScanIssue {
  id: string;
  fingerprint: string;
  type: "console_error" | "network_error" | "broken_link" | "performance";
  severity: "critical" | "high" | "medium" | "low";
  pageUrl: string;
  message: string;
  detail: Record<string, unknown> | null;
  status: "open" | "resolved" | "regressed";
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  todoTaskId: string | null;
  projectId: string | null;
}

import type {
  ApiCheck,
  ApiCheckResult,
  Persona,
  Project,
  Result,
  Run,
  Scenario,
  Schedule,
  TestingWorkflow,
} from "../types/index.js";

export const DEFAULT_COMPACT_LIMIT = 20;
export const MAX_COMPACT_LIMIT = 100;

export interface CompactListOptions {
  limit?: number | null;
  offset?: number | null;
  defaultLimit?: number;
  maxLimit?: number;
}

export function truncateText(value: unknown, max = 80): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
}

export function compactLimit(value: unknown, fallback = DEFAULT_COMPACT_LIMIT, max = MAX_COMPACT_LIMIT): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function compactOffset(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export function listHint(detail: string): string {
  return `Compact output. Use ${detail} for full details.`;
}

export function paginationHint(shown: number, total: number, detail: string, offset = 0): string {
  const start = total > 0 && shown > 0 ? offset + 1 : 0;
  const end = Math.min(offset + shown, total);
  const range = shown > 0 ? `${start}-${end}` : "0";
  const more = total > shown || offset > 0 ? ` Showing ${range} of ${total}.` : "";
  return `${more} ${listHint(detail)}`.trim();
}

export function pageItems<T>(items: T[], options: CompactListOptions = {}): {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  returned: number;
  truncated: boolean;
} {
  const limit = compactLimit(options.limit, options.defaultLimit ?? DEFAULT_COMPACT_LIMIT, options.maxLimit ?? MAX_COMPACT_LIMIT);
  const offset = compactOffset(options.offset);
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    total: items.length,
    limit,
    offset,
    returned: page.length,
    truncated: offset + page.length < items.length,
  };
}

function compactTags(tags: string[] | undefined, max = 5): { tags: string[]; tagCount: number } {
  const all = tags ?? [];
  return {
    tags: all.slice(0, max).map((tag) => truncateText(tag, 30)),
    tagCount: all.length,
  };
}

export function compactScenario(scenario: Scenario) {
  const tags = compactTags(scenario.tags);
  return {
    id: scenario.id,
    shortId: scenario.shortId,
    name: truncateText(scenario.name, 90),
    priority: scenario.priority,
    ...tags,
    steps: scenario.steps.length,
    assertions: scenario.assertions.length,
    targetPath: scenario.targetPath ? truncateText(scenario.targetPath, 80) : null,
    lastPassedAt: scenario.lastPassedAt,
    updatedAt: scenario.updatedAt,
  };
}

export function compactRun(run: Run) {
  return {
    id: run.id,
    shortId: run.id.slice(0, 8),
    status: run.status,
    url: truncateText(run.url, 100),
    model: run.model,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    projectId: run.projectId,
  };
}

export function compactResult(result: Result, scenario?: Scenario | null) {
  return {
    id: result.id,
    shortId: result.id.slice(0, 8),
    runId: result.runId,
    scenarioId: result.scenarioId,
    scenarioShortId: scenario?.shortId ?? null,
    scenarioName: scenario ? truncateText(scenario.name, 80) : null,
    status: result.status,
    steps: `${result.stepsCompleted}/${result.stepsTotal}`,
    durationMs: result.durationMs,
    tokensUsed: result.tokensUsed,
    error: result.error ? truncateText(result.error, 160) : null,
    reasoning: result.reasoning ? truncateText(result.reasoning, 160) : null,
    createdAt: result.createdAt,
  };
}

export function compactProject(project: Project) {
  return {
    id: project.id,
    shortId: project.id.slice(0, 8),
    name: truncateText(project.name, 80),
    path: project.path ? truncateText(project.path, 100) : null,
    baseUrl: project.baseUrl ? truncateText(project.baseUrl, 100) : null,
    createdAt: project.createdAt,
  };
}

export function compactWorkflow(workflow: TestingWorkflow) {
  return {
    id: workflow.id,
    shortId: workflow.id.slice(0, 8),
    name: truncateText(workflow.name, 90),
    enabled: workflow.enabled,
    target: workflow.execution.target,
    provider: workflow.execution.provider ?? null,
    scenarioFilter: workflow.scenarioFilter,
    personas: workflow.personaIds.length,
    hasGoal: Boolean(workflow.goal),
    updatedAt: workflow.updatedAt,
  };
}

export function compactPersona(persona: Persona) {
  return {
    id: persona.id,
    shortId: persona.shortId,
    name: truncateText(persona.name, 80),
    role: truncateText(persona.role, 60),
    projectId: persona.projectId,
    enabled: persona.enabled,
    traits: persona.traits.slice(0, 5).map((trait) => truncateText(trait, 30)),
    traitCount: persona.traits.length,
    authConfigured: Boolean(persona.auth),
    updatedAt: persona.updatedAt,
  };
}

export function compactApiCheck(check: ApiCheck) {
  const tags = compactTags(check.tags);
  return {
    id: check.id,
    shortId: check.shortId,
    name: truncateText(check.name, 80),
    method: check.method,
    url: truncateText(check.url, 100),
    enabled: check.enabled,
    expectedStatus: check.expectedStatus,
    ...tags,
    updatedAt: check.updatedAt,
  };
}

export function compactApiCheckResult(result: ApiCheckResult) {
  return {
    id: result.id,
    shortId: result.id.slice(0, 8),
    checkId: result.checkId,
    status: result.status,
    statusCode: result.statusCode,
    responseTimeMs: result.responseTimeMs,
    error: result.error ? truncateText(result.error, 160) : null,
    assertionsPassed: result.assertionsPassed.length,
    assertionsFailed: result.assertionsFailed.length,
    createdAt: result.createdAt,
  };
}

export function compactSchedule(schedule: Schedule & { nextRunAt?: string | null }) {
  return {
    id: schedule.id,
    shortId: schedule.id.slice(0, 8),
    name: truncateText(schedule.name, 80),
    cronExpression: schedule.cronExpression,
    url: truncateText(schedule.url, 100),
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt ?? null,
    lastRunAt: schedule.lastRunAt,
  };
}

export function compactEnvironment(env: {
  id: string;
  name: string;
  url: string;
  authPresetName: string | null;
  projectId: string | null;
  isDefault: boolean;
  createdAt: string;
}) {
  return {
    id: env.id,
    shortId: env.id.slice(0, 8),
    name: truncateText(env.name, 60),
    url: truncateText(env.url, 100),
    authPresetName: env.authPresetName,
    projectId: env.projectId,
    isDefault: env.isDefault,
    createdAt: env.createdAt,
  };
}

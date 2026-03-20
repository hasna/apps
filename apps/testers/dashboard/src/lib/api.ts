import type { Scenario, Run, Result, Screenshot, Schedule, ApiCheck, ApiCheckResult, Project, Environment } from "../types";

const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

// Scenarios
export const getScenarios = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return fetchJSON<Scenario[]>(`/scenarios${qs}`);
};

export const getScenario = (id: string) =>
  fetchJSON<Scenario>(`/scenarios/${id}`);

export const createScenario = (data: Partial<Scenario>) =>
  fetchJSON<Scenario>("/scenarios", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateScenario = (id: string, data: Partial<import("../types").Scenario>) =>
  fetchJSON<import("../types").Scenario>(`/scenarios/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteScenario = (id: string) =>
  fetchJSON<{ deleted: boolean }>(`/scenarios/${id}`, { method: "DELETE" });

// Runs
export const getRuns = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return fetchJSON<Run[]>(`/runs${qs}`);
};

export const getRun = (id: string) =>
  fetchJSON<{ run: Run; results: Result[] }>(`/runs/${id}`);

// Results
export const getResult = (id: string) =>
  fetchJSON<{ result: Result; screenshots: Screenshot[] }>(`/results/${id}`);

// Screenshots
export const getScreenshotUrl = (id: string) => `${BASE}/screenshots/${id}/file`;

// Trigger a run
export const triggerRun = (body: Record<string, unknown>) =>
  fetchJSON<{ status: string; message: string }>("/runs", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Scenario run history (sparkline)
export const getScenarioHistory = (id: string, limit = 10) =>
  fetchJSON<{ status: string; created_at: string }[]>(`/scenarios/${id}/history?limit=${limit}`);

// Status
export const getStatus = () =>
  fetchJSON<{ dbPath: string; apiKeySet: boolean; scenarioCount: number; runCount: number; version: string }>("/status");

// Schedules
export const getSchedules = () =>
  fetchJSON<Schedule[]>("/schedules");

export const createSchedule = (data: Partial<Schedule>) =>
  fetchJSON<Schedule>("/schedules", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateSchedule = (id: string, updates: Partial<Schedule>) =>
  fetchJSON<Schedule>(`/schedules/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });

export const deleteSchedule = (id: string) =>
  fetchJSON<void>(`/schedules/${id}`, { method: "DELETE" });

// API Checks
export const getApiChecks = (filter?: { projectId?: string; enabled?: boolean }): Promise<ApiCheck[]> => {
  const params = new URLSearchParams();
  if (filter?.projectId) params.set("projectId", filter.projectId);
  if (filter?.enabled !== undefined) params.set("enabled", String(filter.enabled));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchJSON<ApiCheck[]>(`/api-checks${qs}`);
};

export const createApiCheck = (input: Partial<ApiCheck>): Promise<ApiCheck> =>
  fetchJSON<ApiCheck>("/api-checks", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateApiCheck = (id: string, updates: Partial<ApiCheck> & { version: number }): Promise<ApiCheck> =>
  fetchJSON<ApiCheck>(`/api-checks/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });

export const deleteApiCheck = (id: string): Promise<void> =>
  fetchJSON<void>(`/api-checks/${id}`, { method: "DELETE" });

export const runApiCheck = (id: string, baseUrl?: string): Promise<ApiCheckResult> =>
  fetchJSON<ApiCheckResult>(`/api-checks/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ baseUrl }),
  });

export const runAllApiChecks = (params: {
  baseUrl: string;
  projectId?: string;
  tags?: string[];
  parallel?: number;
}): Promise<{ results: ApiCheckResult[]; passed: number; failed: number; errors: number }> =>
  fetchJSON("/api-checks/run-all", {
    method: "POST",
    body: JSON.stringify(params),
  });

export const getApiCheckResults = (checkId: string, limit = 10): Promise<ApiCheckResult[]> =>
  fetchJSON<ApiCheckResult[]>(`/api-checks/${checkId}/results?limit=${limit}`);

// Projects
export const getProjects = (): Promise<Project[]> =>
  fetchJSON<Project[]>("/projects");

export const createProject = (input: { name: string; description?: string }): Promise<Project> =>
  fetchJSON<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateProject = (id: string, updates: Partial<Pick<Project, "name" | "description" | "baseUrl" | "port">>): Promise<Project> =>
  fetchJSON<Project>(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });

// Environments
export const getProjectEnvironments = (projectId: string): Promise<Environment[]> =>
  fetchJSON<Environment[]>(`/projects/${projectId}/environments`);

export const createEnvironment = (projectId: string, input: {
  name: string;
  url: string;
  variables?: Record<string, string>;
  isDefault?: boolean;
}): Promise<Environment> =>
  fetchJSON<Environment>(`/projects/${projectId}/environments`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateEnvironment = (id: string, updates: Partial<{
  name: string;
  url: string;
  variables: Record<string, string>;
  isDefault: boolean;
}>): Promise<Environment> =>
  fetchJSON<Environment>(`/environments/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });

export const deleteEnvironment = (id: string): Promise<void> =>
  fetchJSON<void>(`/environments/${id}`, { method: "DELETE" });

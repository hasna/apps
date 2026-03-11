import type { Scenario, Run, Result, Screenshot } from "../types";

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

// Status
export const getStatus = () =>
  fetchJSON<{ dbPath: string; apiKeySet: boolean; scenarioCount: number; runCount: number; version: string }>("/status");

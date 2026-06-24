const BASE = "";
const API_KEY_STORAGE_KEY = "hasna.computer.apiKey";

let memoryApiKey = "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Session {
  id: string;
  task: string;
  provider: string;
  model: string;
  status: string;
  steps: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_duration_ms: number;
  tags?: string[];
  error?: string;
  created_at: string;
  completed_at?: string;
}

export interface ActionLog {
  id: number;
  session_id: string;
  step: number;
  action: { type: string; [key: string]: any };
  reasoning: string;
  screenshot_path?: string;
  success: boolean;
  error?: string;
  duration_ms: number;
  tokens_in?: number;
  tokens_out?: number;
  created_at: string;
}

export type TimelineKind =
  | "run_step"
  | "model_decision"
  | "action"
  | "observation"
  | "approval"
  | "artifact"
  | "policy"
  | "verifier"
  | "model_usage";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  source: string;
  timestamp: string;
  title: string;
  summary?: string;
  status?: string;
  step?: number;
  capability?: string;
  action?: unknown;
  result?: unknown;
  data?: unknown;
  artifact_path?: string;
  duration_ms?: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  provider?: string;
  model?: string;
  cost_usd?: number;
}

export interface SessionTimeline {
  run: {
    id: string;
    goal_id?: string;
    workflow_id?: string;
    status: string;
    created_at: string;
    updated_at: string;
    completed_at?: string;
    error?: string;
  } | null;
  items: TimelineItem[];
  counts: Record<TimelineKind, number>;
  last_event_at?: string;
}

export interface SessionDetailResponse {
  session: Session;
  action_logs: ActionLog[];
  timeline?: SessionTimeline;
}

export interface Stats {
  total_sessions: number;
  completed: number;
  failed: number;
  total_steps: number;
  total_tokens: number;
}

export function getStoredApiKey(): string {
  try {
    return globalThis.localStorage?.getItem(API_KEY_STORAGE_KEY)?.trim() || memoryApiKey;
  } catch {
    return memoryApiKey;
  }
}

export function setStoredApiKey(apiKey: string): void {
  memoryApiKey = apiKey.trim();
  try {
    if (memoryApiKey) globalThis.localStorage?.setItem(API_KEY_STORAGE_KEY, memoryApiKey);
    else globalThis.localStorage?.removeItem(API_KEY_STORAGE_KEY);
  } catch {}
}

export function clearStoredApiKey(): void {
  memoryApiKey = "";
  try {
    globalThis.localStorage?.removeItem(API_KEY_STORAGE_KEY);
  } catch {}
}

function requestHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("accept", "application/json");
  const apiKey = getStoredApiKey();
  if (apiKey && !result.has("authorization") && !result.has("x-computer-api-key")) {
    result.set("authorization", `Bearer ${apiKey}`);
  }
  return result;
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: requestHeaders(init.headers),
  });
  const body = await parseResponseBody(res);
  if (!res.ok) {
    const message = typeof body === "object" && body && "error" in body
      ? String((body as { error: unknown }).error)
      : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

export async function fetchSessions(limit = 50): Promise<Session[]> {
  return requestJson<Session[]>(`/sessions?limit=${limit}`);
}

export async function fetchSession(id: string): Promise<SessionDetailResponse> {
  return requestJson<SessionDetailResponse>(`/sessions/${id}`);
}

export async function fetchStats(): Promise<Stats> {
  return requestJson<Stats>("/stats");
}

export async function fetchScreenshot(): Promise<{ base64: string; size: { width: number; height: number } }> {
  return requestJson<{ base64: string; size: { width: number; height: number } }>("/screenshot");
}

export async function deleteSession(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(`/sessions/${id}`, { method: "DELETE" });
}

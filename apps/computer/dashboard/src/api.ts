const BASE = "";

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

export interface Stats {
  total_sessions: number;
  completed: number;
  failed: number;
  total_steps: number;
  total_tokens: number;
}

export async function fetchSessions(limit = 50): Promise<Session[]> {
  const res = await fetch(`${BASE}/sessions?limit=${limit}`);
  return res.json();
}

export async function fetchSession(id: string): Promise<{ session: Session; action_logs: ActionLog[] }> {
  const res = await fetch(`${BASE}/sessions/${id}`);
  return res.json();
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${BASE}/stats`);
  return res.json();
}

export async function fetchScreenshot(): Promise<{ base64: string; size: { width: number; height: number } }> {
  const res = await fetch(`${BASE}/screenshot`);
  return res.json();
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`${BASE}/sessions/${id}`, { method: "DELETE" });
}

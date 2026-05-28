// Core types matching the server API responses

export interface Task {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  project_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  assigned_to: string | null;
  locked_by: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  task_list_id: string | null;
  task_prefix: string | null;
  task_counter: number;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  project_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  name: string;
  description: string | null;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  role: string | null;
  permissions: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
}

export interface TaskHistory {
  id: string;
  task_id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  agent_id: string | null;
  created_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  title_pattern: string;
  description: string | null;
  priority: string;
  tags: string[];
  project_id: string | null;
  plan_id: string | null;
  created_at: string;
}

export interface Stats {
  total_tasks: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  projects: number;
  agents: number;
}

export interface BulkResult {
  results: { id: string; success: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}

export interface AgentProfile {
  agent: Agent;
  pending_tasks: Task[];
  in_progress_tasks: Task[];
  stats: { total: number; pending: number; in_progress: number; completed: number; completion_rate: number };
}

export interface ClaimResult {
  task: Task | null;
  locked_by?: string;
  locked_since?: string;
  suggested_task?: Task | null;
}

export interface CompletionEvidence {
  files_changed?: string[];
  test_results?: string;
  commit_hash?: string;
  notes?: string;
}

export interface TodosClientOptions {
  baseUrl?: string;
  agentName?: string;
  agentRole?: string;
}

export interface TaskSummary {
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
  recurrence_rule?: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  description: string | null;
  task_prefix: string | null;
  task_counter: number;
  created_at: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface DashboardStats {
  total_tasks: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  projects: number;
  agents: number;
  stale_count?: number;
  overdue_recurring?: number;
  recurring_tasks?: number;
}

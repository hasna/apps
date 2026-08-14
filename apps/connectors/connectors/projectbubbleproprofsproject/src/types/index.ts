export interface ProProfsProjectConfig { apiKey: string; }

export interface PPProject { id: string; name: string; description: string; status: string; owner: { id: string; name: string }; start_date: string; end_date: string; progress: number; created_at: string; }
export interface PPTask { id: string; project_id: string; title: string; description: string; status: string; priority: string; assignee: { id: string; name: string } | null; due_date: string | null; start_date: string | null; progress: number; created_at: string; updated_at: string; }
export interface PPTaskList { tasks: PPTask[]; total: number; page: number; per_page: number; }
export interface PPMember { id: string; name: string; email: string; role: string; }
export interface PPTimeLog { id: string; task_id: string; user_id: string; hours: number; description: string; date: string; }

export class ProProfsProjectApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ProProfsProjectApiError'; this.statusCode = statusCode; }
}

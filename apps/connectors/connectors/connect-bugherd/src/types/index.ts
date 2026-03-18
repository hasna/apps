export interface BugHerdConfig { apiKey: string; }

export interface BHProject { id: number; name: string; devurl: string; is_active: boolean; is_public: boolean; members: { id: number; display_name: string; email: string }[]; }
export interface BHTask { id: number; project_id: number; description: string; status_id: number; priority_id: number; tag_names: string[]; external_id: string | null; requester: { id: number; display_name: string; email: string }; assignee: { id: number; display_name: string; email: string } | null; created_at: string; updated_at: string; screenshot_url: string | null; url: string; selector: string; }
export interface BHTaskList { tasks: BHTask[]; meta: { count: number; page: number; total_pages: number }; }
export interface BHComment { id: number; task_id: number; text: string; user: { id: number; display_name: string }; created_at: string; }
export interface BHWebhook { id: number; project_id: number; target_url: string; event: string; }

export class BugHerdApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BugHerdApiError'; this.statusCode = statusCode; }
}

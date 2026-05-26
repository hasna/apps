export interface KanbanToolConfig { domain: string; apiToken: string; }

export interface KTBoard { id: number; name: string; description: string; position: number; board_type: string; columns: KTColumn[]; }
export interface KTColumn { id: number; name: string; position: number; wip_limit: number | null; }
export interface KTTask { id: number; board_id: number; name: string; description: string; column_id: number; position: number; color: string; priority: number; assignee_ids: number[]; due_date: string | null; tags: string[]; created_at: string; updated_at: string; }
export interface KTUser { id: number; name: string; email: string; role: string; }
export interface KTComment { id: number; task_id: number; body: string; author: { id: number; name: string }; created_at: string; }

export class KanbanToolApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'KanbanToolApiError'; this.statusCode = statusCode; }
}

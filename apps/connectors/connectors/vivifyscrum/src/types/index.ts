export interface VivifyScrumConfig { token: string; }

export interface VSBoard { id: number; name: string; description: string; type: string; columns: VSColumn[]; created_at: string; }
export interface VSColumn { id: number; name: string; position: number; wip_limit: number | null; }
export interface VSItem { id: number; board_id: number; column_id: number; title: string; description: string; type: 'story' | 'task' | 'bug' | 'epic'; priority: string; assignee: { id: number; name: string } | null; story_points: number | null; labels: string[]; created_at: string; updated_at: string; }
export interface VSItemList { items: VSItem[]; total: number; page: number; per_page: number; }
export interface VSSprint { id: number; board_id: number; name: string; goal: string; status: 'active' | 'completed' | 'planned'; start_date: string; end_date: string; }
export interface VSMember { id: number; name: string; email: string; role: string; avatar_url: string; }

export class VivifyScrumApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'VivifyScrumApiError'; this.statusCode = statusCode; }
}

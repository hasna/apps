export interface MattermostConfig { url: string; token: string; }

export interface MMUser { id: string; username: string; email: string; first_name: string; last_name: string; nickname: string; roles: string; create_at: number; delete_at: number; }
export interface MMTeam { id: string; name: string; display_name: string; description: string; type: 'O' | 'I'; create_at: number; }
export interface MMChannel { id: string; team_id: string; name: string; display_name: string; type: 'O' | 'P' | 'D' | 'G'; header: string; purpose: string; creator_id: string; create_at: number; }
export interface MMPost { id: string; channel_id: string; user_id: string; message: string; type: string; create_at: number; update_at: number; delete_at: number; root_id: string; file_ids?: string[]; }
export interface MMPostList { order: string[]; posts: Record<string, MMPost>; }

export class MattermostApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MattermostApiError'; this.statusCode = statusCode; }
}

export interface UserVoiceConfig { apiKey: string; subdomain: string; baseUrl?: string; }
export interface UVSuggestion { id: number; title: string; body: string; vote_count: number; status: string; category: { id: number; name: string } | null; creator: { id: number; name: string; email: string } | null; created_at: string; updated_at: string; }
export interface UVUser { id: number; name: string; email: string; created_at: string; }
export interface UVForum { id: number; name: string; welcome_message: string | null; default_forum: boolean; }
export interface UVTicket { id: number; subject: string; body: string; state: string; assignee: UVUser | null; created_at: string; }
export class UserVoiceApiError extends Error { public readonly statusCode: number; constructor(message: string, statusCode: number) { super(message); this.name = 'UserVoiceApiError'; this.statusCode = statusCode; } }

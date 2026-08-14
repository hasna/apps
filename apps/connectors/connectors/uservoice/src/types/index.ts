export interface UserVoiceConfig { token: string; subdomain: string; }

export interface UVSuggestion { id: number; title: string; body: string; state: string; vote_count: number; supporter_count: number; comments_count: number; status: { id: number; name: string }; category: { id: number; name: string } | null; creator: { id: number; name: string; email: string }; created_at: string; updated_at: string; }
export interface UVSuggestionList { suggestions: UVSuggestion[]; pagination: { page: number; per_page: number; total_records: number; total_pages: number }; }
export interface UVUser { id: number; name: string; email: string; created_at: string; updated_at: string; supported_suggestions_count: number; }
export interface UVUserList { users: UVUser[]; pagination: { page: number; per_page: number; total_records: number; total_pages: number }; }
export interface UVForum { id: number; name: string; welcome_message: string; suggestions_count: number; open_suggestions_count: number; }
export interface UVStatus { id: number; name: string; hex_color: string; is_open: boolean; }
export interface UVCategory { id: number; name: string; suggestions_count: number; }
export interface UVComment { id: number; body: string; creator: { id: number; name: string }; created_at: string; }

export class UserVoiceApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'UserVoiceApiError'; this.statusCode = statusCode; }
}

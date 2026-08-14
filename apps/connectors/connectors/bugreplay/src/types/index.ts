export interface BugReplayConfig { apiKey: string; }

export interface BRBug { id: string; title: string; description: string; status: string; priority: string; reporter: { id: string; name: string; email: string }; assignee: { id: string; name: string } | null; recording_url: string; screenshot_url: string | null; browser: string; os: string; url: string; created_at: string; updated_at: string; }
export interface BRBugList { bugs: BRBug[]; total: number; page: number; per_page: number; }
export interface BRProject { id: string; name: string; slug: string; bugs_count: number; created_at: string; }
export interface BRComment { id: string; bug_id: string; body: string; author: { id: string; name: string }; created_at: string; }

export class BugReplayApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BugReplayApiError'; this.statusCode = statusCode; }
}

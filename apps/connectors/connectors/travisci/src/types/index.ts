export interface TravisCIConfig { token: string; baseUrl?: string; }

export interface TCRepo { id: number; name: string; slug: string; description: string; active: boolean; private: boolean; default_branch: { name: string }; owner: { login: string }; last_build: { id: number; number: string; state: string; duration: number; started_at: string; finished_at: string } | null; }
export interface TCBuild { id: number; number: string; state: string; duration: number | null; event_type: string; branch: { name: string }; commit: { sha: string; message: string; author: { name: string } }; created_by: { login: string }; started_at: string; finished_at: string | null; jobs: { id: number }[]; }
export interface TCJob { id: number; number: string; state: string; started_at: string; finished_at: string | null; queue: string; os: string; log: { id: number }; }
export interface TCUser { id: number; login: string; name: string; email: string; avatar_url: string; is_syncing: boolean; synced_at: string; }

export class TravisCIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TravisCIApiError'; this.statusCode = statusCode; }
}

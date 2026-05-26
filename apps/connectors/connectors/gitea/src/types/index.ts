export interface GiteaConfig { token: string; url: string; }

export interface GiteaRepo { id: number; name: string; full_name: string; description: string; private: boolean; fork: boolean; html_url: string; clone_url: string; default_branch: string; stars_count: number; forks_count: number; open_issues_count: number; owner: { id: number; login: string; avatar_url: string }; created_at: string; updated_at: string; }
export interface GiteaIssue { id: number; number: number; title: string; body: string; state: string; labels: { id: number; name: string; color: string }[]; assignee: { id: number; login: string } | null; milestone: { id: number; title: string } | null; created_at: string; updated_at: string; closed_at: string | null; }
export interface GiteaUser { id: number; login: string; full_name: string; email: string; avatar_url: string; created: string; }
export interface GiteaOrg { id: number; username: string; full_name: string; description: string; avatar_url: string; }
export interface GiteaBranch { name: string; commit: { id: string; message: string; url: string }; protected: boolean; }
export interface GiteaPullRequest { id: number; number: number; title: string; body: string; state: string; head: { ref: string; sha: string }; base: { ref: string; sha: string }; user: { login: string }; merged: boolean; created_at: string; }

export class GiteaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GiteaApiError'; this.statusCode = statusCode; }
}

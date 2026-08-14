export interface BuildkiteConfig { token: string; }

export interface BKOrganization { id: string; slug: string; name: string; url: string; web_url: string; pipelines_url: string; created_at: string; }
export interface BKPipeline { id: string; slug: string; name: string; description: string; url: string; web_url: string; repository: string; default_branch: string; running_builds_count: number; scheduled_builds_count: number; created_at: string; }
export interface BKBuild { id: string; number: number; state: string; message: string; commit: string; branch: string; source: string; created_at: string; started_at: string | null; finished_at: string | null; web_url: string; creator: { id: string; name: string; email: string }; jobs: BKJob[]; }
export interface BKJob { id: string; type: string; name: string; state: string; command: string; exit_status: number | null; started_at: string | null; finished_at: string | null; web_url: string; log_url: string; }
export interface BKAgent { id: string; name: string; hostname: string; ip_address: string; version: string; connected: boolean; job: BKJob | null; created_at: string; }

export class BuildkiteApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BuildkiteApiError'; this.statusCode = statusCode; }
}

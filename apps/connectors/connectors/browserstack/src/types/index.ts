export interface BrowserStackConfig { username: string; accessKey: string; }

export interface BSBrowser { os: string; os_version: string; browser: string; browser_version: string; device: string | null; real_mobile: boolean; }
export interface BSBuild { automation_build: { name: string; duration: number; status: string; hashed_id: string; build_tag: string | null; }; }
export interface BSSession { automation_session: { name: string; duration: number; os: string; os_version: string; browser_version: string; browser: string; status: string; hashed_id: string; reason: string; build_name: string; project_name: string; logs: string; browser_url: string; video_url: string; }; }
export interface BSProject { id: number; name: string; group_id: number; created_at: string; updated_at: string; }
export interface BSPlan { automate_plan: string; parallel_sessions_running: number; team_parallel_sessions_max_allowed: number; parallel_sessions_max_allowed: number; queued_sessions: number; queued_sessions_max_allowed: number; }

export class BrowserStackApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BrowserStackApiError'; this.statusCode = statusCode; }
}

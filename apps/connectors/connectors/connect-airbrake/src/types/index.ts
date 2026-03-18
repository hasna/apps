export interface AirbrakeConfig { projectId: string; projectKey: string; baseUrl?: string; }

export interface AirbrakeError { id: number; type: string; message: string; airbrake_error_id: number; created_at: string; updated_at: string; resolved: boolean; muted: boolean; severity: string; occurrences_count: number; last_notice_at: string; context: Record<string, unknown>; }
export interface AirbrakeErrorList { errors: AirbrakeError[]; count: number; page: number; pages: number; }
export interface AirbrakeNotice { id: string; error_id: number; created_at: string; context: Record<string, unknown>; environment: Record<string, unknown>; params: Record<string, unknown>; session: Record<string, unknown>; backtrace: { file: string; function: string; line: number; column: number }[]; }
export interface AirbrakeNoticeList { notices: AirbrakeNotice[]; count: number; page: number; }
export interface AirbrakeProject { id: number; name: string; created_at: string; updated_at: string; deploy_key: string; }
export interface AirbrakeDeploy { id: number; environment: string; username: string; repository: string; revision: string; version: string; created_at: string; }
export interface AirbrakeDeployList { deploys: AirbrakeDeploy[]; count: number; }

export class AirbrakeApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AirbrakeApiError'; this.statusCode = statusCode; }
}

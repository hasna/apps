export interface LambdaTestConfig { username: string; accessKey: string; }

export interface LTBuild { build_id: string; name: string; status_ind: string; start_timestamp: string; end_timestamp: string | null; user_id: number; }
export interface LTSession { session_id: string; build_id: string; name: string; status_ind: string; browser: string; version: string; os: string; os_version: string; resolution: string; duration: number; start_timestamp: string; end_timestamp: string | null; test_type: string; }
export interface LTSessionList { data: LTSession[]; Meta: { total: number; offset: number; limit: number }; }
export interface LTTunnel { tunnel_id: string; tunnel_name: string; status: string; }
export interface LTPlatform { platform: string; browsers: { browser_name: string; version: string }[]; }

export class LambdaTestApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LambdaTestApiError'; this.statusCode = statusCode; }
}

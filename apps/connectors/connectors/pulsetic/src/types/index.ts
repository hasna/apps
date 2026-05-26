export interface PulseticConfig { apiKey: string; }

export interface PLMonitor { id: number; name: string; url: string; type: string; interval: number; status: string; uptime: number; last_checked_at: string; created_at: string; }
export interface PLMonitorList { data: PLMonitor[]; total: number; }
export interface PLIncident { id: number; monitor_id: number; status: string; cause: string; started_at: string; resolved_at: string | null; duration: number | null; }
export interface PLStatusPage { id: number; name: string; subdomain: string; custom_domain: string | null; monitors: number[]; }
export interface PLHeartbeat { timestamp: string; status: number; response_time: number; }

export class PulseticApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PulseticApiError'; this.statusCode = statusCode; }
}

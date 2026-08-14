export interface AlertyConfig { apiKey: string; }

export interface AlertyMonitor { id: string; name: string; url: string; type: string; status: string; interval: number; regions: string[]; last_checked_at: string; created_at: string; }
export interface AlertyMonitorList { monitors: AlertyMonitor[]; total: number; }
export interface AlertyIncident { id: string; monitor_id: string; status: string; cause: string; started_at: string; resolved_at: string | null; duration: number | null; }
export interface AlertyIncidentList { incidents: AlertyIncident[]; total: number; }
export interface AlertyStatusPage { id: string; name: string; subdomain: string; custom_domain: string | null; monitors: string[]; }
export interface AlertyAlert { id: string; type: string; channel: string; target: string; }

export class AlertyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AlertyApiError'; this.statusCode = statusCode; }
}

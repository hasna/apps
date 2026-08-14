// UptimeRobot uses POST for ALL requests, even reads
export interface UptimeRobotConfig { apiKey: string; baseUrl?: string; }

export interface URMonitor { id: number; friendly_name: string; url: string; type: number; status: number; interval: number; create_datetime: number; all_time_uptime_ratio: string; custom_uptime_ranges?: string; logs?: URLog[]; }
export interface URLog { type: number; datetime: number; duration: number; reason?: { code: string; detail: string }; }
export interface URAlertContact { id: number; friendly_name: string; type: number; status: number; value: string; }
export interface URAccount { email: string; monitor_limit: number; monitor_interval: number; up_monitors: number; down_monitors: number; paused_monitors: number; }

export class UptimeRobotApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'UptimeRobotApiError'; this.statusCode = statusCode; }
}

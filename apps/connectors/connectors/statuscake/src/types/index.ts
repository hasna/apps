export interface StatusCakeConfig { apiKey: string; }

export interface SCTest { id: string; name: string; test_type: string; website_url: string; check_rate: number; status: string; uptime: number; tags: string[]; contact_groups: string[]; paused: boolean; }
export interface SCTestList { data: SCTest[]; metadata: { page: number; per_page: number; page_count: number; total_count: number }; }
export interface SCAlert { id: string; test_id: string; status_code: number; status: string; triggered_at: string; resolved_at: string | null; }
export interface SCContactGroup { id: string; name: string; email_addresses: string[]; mobile_numbers: string[]; integrations: string[]; }
export interface SCMaintenanceWindow { id: string; name: string; start_at: string; end_at: string; repeat_interval: string; tests: string[]; }
export interface SCPagespeedTest { id: string; name: string; website_url: string; location: string; check_rate: number; latest_stats: { loadtime: number; filesize: number; requests: number }; }

export class StatusCakeApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'StatusCakeApiError'; this.statusCode = statusCode; }
}

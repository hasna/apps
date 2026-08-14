import type { ZohoWorkDriveConfig } from '../types';
import { ZohoWorkDriveApiError } from '../types';

export class ZohoWorkDriveClient {
  private readonly token: string;
  private readonly teamId: string;
  private readonly baseUrl: string;

  constructor(config: ZohoWorkDriveConfig) {
    if (!config.token || !config.teamId) throw new Error('Zoho WorkDrive token and teamId are required');
    this.token = config.token;
    this.teamId = config.teamId;
    this.baseUrl = (config.baseUrl || 'https://www.zohoapis.com/workdrive/api/v1').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ZohoWorkDriveApiError((data as { errors?: { title?: string }[] })?.errors?.[0]?.title || response.statusText, response.status);
    return data as T;
  }

  getTeamId(): string { return this.teamId; }
}

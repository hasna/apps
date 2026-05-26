import type { GoToWebinarConfig } from '../types';
import { GoToWebinarApiError } from '../types';

export class GoToWebinarClient {
  private readonly token: string;
  private readonly organizerKey: string;
  private readonly baseUrl = 'https://api.getgo.com/G2W/rest/v2';

  constructor(config: GoToWebinarConfig) {
    if (!config.token || !config.organizerKey) throw new Error('GoTo Webinar token and organizerKey are required');
    this.token = config.token;
    this.organizerKey = config.organizerKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GoToWebinarApiError((data as { description?: string })?.description || response.statusText, response.status);
    return data as T;
  }

  getOrganizerKey(): string { return this.organizerKey; }
}

import type { TalentLMSConfig } from '../types';
import { TalentLMSApiError } from '../types';

export class TalentLMSClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: TalentLMSConfig) {
    if (!config.apiKey || !config.domain) throw new Error('TalentLMS apiKey and domain are required');
    // TalentLMS uses HTTP Basic auth with apiKey as username, empty password
    this.authHeader = `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`;
    this.baseUrl = config.baseUrl || `https://${config.domain}.talentlms.com/api/v1`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const headers: Record<string, string> = { Authorization: this.authHeader, Accept: 'application/json' };
    if (body && ['POST', 'PUT'].includes(method)) headers['Content-Type'] = 'application/json';

    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || response.statusText;
      throw new TalentLMSApiError(msg, response.status);
    }
    return data as T;
  }
}

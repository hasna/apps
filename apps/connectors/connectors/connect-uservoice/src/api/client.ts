import type { UserVoiceConfig } from '../types';
import { UserVoiceApiError } from '../types';
export class UserVoiceClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(config: UserVoiceConfig) {
    if (!config.apiKey || !config.subdomain) throw new Error('UserVoice apiKey and subdomain are required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || `https://${config.subdomain}.uservoice.com/api/v2`;
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new UserVoiceApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

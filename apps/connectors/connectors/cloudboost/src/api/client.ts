import type { CloudBoostConfig } from '../types';
import { CloudBoostApiError } from '../types';

export class CloudBoostClient {
  private readonly appId: string;
  private readonly masterKey: string;
  private readonly baseUrl: string;

  constructor(config: CloudBoostConfig) {
    if (!config.appId || !config.masterKey) throw new Error('CloudBoost appId and masterKey are required');
    this.appId = config.appId;
    this.masterKey = config.masterKey;
    this.baseUrl = `https://api.cloudboost.io/${config.appId}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { masterKey: this.masterKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url, fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CloudBoostApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

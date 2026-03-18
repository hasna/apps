import type { LambdaTestConfig } from '../types';
import { LambdaTestApiError } from '../types';

export class LambdaTestClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://api.lambdatest.com/automation/api/v1';

  constructor(config: LambdaTestConfig) {
    if (!config.username || !config.accessKey) throw new Error('LambdaTest username and accessKey are required');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.accessKey}`)}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new LambdaTestApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

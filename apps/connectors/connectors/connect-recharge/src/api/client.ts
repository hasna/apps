import type { RechargeConfig } from '../types';
import { RechargeApiError } from '../types';

export class RechargeClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.rechargeapps.com';

  constructor(config: RechargeConfig) {
    if (!config.token) throw new Error('Recharge token is required');
    this.token = config.token;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-Recharge-Access-Token': this.token, 'Content-Type': 'application/json', 'X-Recharge-Version': '2021-11' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RechargeApiError((data as { errors?: string })?.errors || response.statusText, response.status);
    return data as T;
  }
}

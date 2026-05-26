import type { LoginRadiusConfig } from '../types';
import { LoginRadiusApiError } from '../types';

export class LoginRadiusClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;

  constructor(config: LoginRadiusConfig) {
    if (!config.apiKey || !config.apiSecret || !config.appName) throw new Error('LoginRadius apiKey, apiSecret, and appName are required');
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = `https://api.loginradius.com`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('apikey', this.apiKey);
    url.searchParams.append('apisecret', this.apiSecret);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data as { ErrorCode?: number }).ErrorCode) {
      const err = data as { Message?: string; ErrorCode?: number; Description?: string };
      throw new LoginRadiusApiError(err.Description || err.Message || response.statusText, response.status, err.ErrorCode);
    }
    return data as T;
  }
}

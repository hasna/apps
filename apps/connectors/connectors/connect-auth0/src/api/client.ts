import type { Auth0Config } from '../types';
import { Auth0ApiError } from '../types';

export class Auth0Client {
  private readonly managementToken: string;
  readonly baseUrl: string; // domain-based URL, exposed for tenant operations

  constructor(config: Auth0Config) {
    if (!config.domain || !config.managementToken) throw new Error('Auth0 domain and managementToken are required');
    this.managementToken = config.managementToken;
    this.baseUrl = `https://${config.domain}/api/v2`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.managementToken}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Auth0ApiError((data as { message?: string; error?: string })?.message || (data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}

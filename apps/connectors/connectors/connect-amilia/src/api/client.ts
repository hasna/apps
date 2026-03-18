import type { AmiliaConfig } from '../types';
import { AmiliaApiError } from '../types';

export class AmiliaClient {
  private readonly token: string;
  private readonly organizationId: string;
  private readonly baseUrl = 'https://www.amilia.com/api/v3';

  constructor(config: AmiliaConfig) {
    if (!config.token || !config.organizationId) throw new Error('Amilia token and organizationId are required');
    this.token = config.token;
    this.organizationId = config.organizationId;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}/organizations/${this.organizationId}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AmiliaApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

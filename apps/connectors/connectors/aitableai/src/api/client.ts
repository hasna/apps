import type { AITableConfig } from '../types';
import { AITableApiError } from '../types';

export class AITableClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: AITableConfig) {
    if (!config.token) throw new Error('AITable.ai token is required');
    this.token = config.token;
    this.baseUrl = (config.baseUrl || 'https://aitable.ai/fusion/v1').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => ({})) as { success?: boolean; code?: number; message?: string; data?: unknown };
    if (!response.ok || data.success === false) throw new AITableApiError(data.message || response.statusText, response.status, data.code);
    return (data.data ?? data) as T;
  }
}

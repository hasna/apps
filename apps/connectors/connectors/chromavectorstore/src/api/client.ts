import type { ChromaConfig } from '../types';
import { ChromaApiError } from '../types';

export class ChromaClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly tenant: string;
  private readonly database: string;

  constructor(config: ChromaConfig) {
    if (!config.url) throw new Error('Chroma url is required');
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api/v1`;
    this.token = config.token;
    this.tenant = config.tenant || 'default_tenant';
    this.database = config.database || 'default_database';
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ChromaApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    return data as T;
  }

  getTenant(): string { return this.tenant; }
  getDatabase(): string { return this.database; }
}

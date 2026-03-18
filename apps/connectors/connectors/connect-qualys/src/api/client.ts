import type { QualysConfig } from '../types';
import { QualysApiError } from '../types';

export class QualysClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: QualysConfig) {
    if (!config.username || !config.password) throw new Error('Qualys username and password are required');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    this.baseUrl = config.platform || 'https://qualysapi.qualys.com';
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | URLSearchParams; params?: Record<string, string | number | undefined>; xml?: boolean } = {}): Promise<T> {
    const { method = 'GET', body, params, xml } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'X-Requested-With': 'Qualys Connector' };
    if (!xml) headers.Accept = 'application/json';
    if (body && !(body instanceof URLSearchParams)) headers['Content-Type'] = 'application/json';
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = body instanceof URLSearchParams ? body : JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new QualysApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

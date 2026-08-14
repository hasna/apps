import type { JenkinsConfig } from '../types';
import { JenkinsApiError } from '../types';

export class JenkinsClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: JenkinsConfig) {
    if (!config.url || !config.username || !config.apiToken) throw new Error('Jenkins url, username, and apiToken are required');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.apiToken}`)}`;
    this.baseUrl = config.url.replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: string; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader };
    if (method === 'GET') headers.Accept = 'application/json';
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = body;
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 201 || response.status === 204 || response.status === 302) return {} as T;
    if (!response.ok) throw new JenkinsApiError(response.statusText, response.status);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return (await response.json()) as T;
    return {} as T;
  }

  getCrumb(): Promise<{ crumb: string; crumbRequestField: string }> {
    return this.request('/crumbIssuer/api/json');
  }
}

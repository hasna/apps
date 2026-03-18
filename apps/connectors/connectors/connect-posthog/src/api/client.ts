import type { PostHogConfig } from '../types';
import { PostHogApiError } from '../types';

export class PostHogClient {
  private readonly apiKey: string;
  readonly baseUrl: string; // exposed for capture endpoint (different from API)

  constructor(config: PostHogConfig) {
    if (!config.apiKey) throw new Error('PostHog API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = `${config.host || 'https://app.posthog.com'}/api`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new PostHogApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    return data as T;
  }
}

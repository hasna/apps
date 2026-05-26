import type { RelevanceAIConfig } from '../types';
import { RelevanceAIApiError } from '../types';

export class RelevanceAIClient {
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly baseUrl: string;

  constructor(config: RelevanceAIConfig) {
    if (!config.apiKey || !config.projectId) throw new Error('Relevance AI apiKey and projectId are required');
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    const region = config.region || 'us-east-1';
    this.baseUrl = `https://api-${region}.stack.tryrelevance.com/latest`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `${this.projectId}:${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RelevanceAIApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

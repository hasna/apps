import type { AzureAISearchConfig } from '../types';
import { AzureAISearchApiError } from '../types';

export class AzureAISearchClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(config: AzureAISearchConfig) {
    if (!config.serviceName || !config.apiKey) throw new Error('Azure AI Search serviceName and apiKey are required');
    this.apiKey = config.apiKey;
    this.baseUrl = `https://${config.serviceName}.search.windows.net`;
    this.apiVersion = config.apiVersion || '2024-07-01';
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('api-version', this.apiVersion);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'api-key': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AzureAISearchApiError((data as { error?: { message?: string } })?.error?.message || response.statusText, response.status);
    return data as T;
  }
}

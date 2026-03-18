import type { SeamlessAIConfig } from '../types';
import { SeamlessAIApiError } from '../types';
const DEFAULT_BASE_URL = 'https://api.seamless.ai/v1';
export class SeamlessAIClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(config: SeamlessAIConfig) {
    if (!config.apiKey) throw new Error('Seamless.AI API key is required');
    this.apiKey = config.apiKey; this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | undefined>): Promise<T> {
    const method = body ? 'POST' : 'GET';
    const url = new URL(`${this.baseUrl}${path}`);
    if (params && method === 'GET') Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new SeamlessAIApiError((data as { message?: string; detail?: string })?.message || (data as { detail?: string })?.detail || response.statusText, response.status);
    return data as T;
  }
}

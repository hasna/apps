import type { HybridAnalysisConfig } from '../types';
import { HybridAnalysisApiError } from '../types';

export class HybridAnalysisClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.hybrid-analysis.com/api/v2';

  constructor(config: HybridAnalysisConfig) {
    if (!config.apiKey) throw new Error('Hybrid Analysis apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | URLSearchParams; params?: Record<string, string | number | undefined>; form?: boolean } = {}): Promise<T> {
    const { method = 'GET', body, params, form } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'api-key': this.apiKey, 'User-Agent': 'Falcon Sandbox' };
    if (!form) headers['Content-Type'] = 'application/json';
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST'].includes(method)) {
      if (form) {
        const fd = new URLSearchParams();
        if (body instanceof URLSearchParams) { fetchOptions.body = body; } else { Object.entries(body).forEach(([k, v]) => { if (v !== undefined) fd.append(k, String(v)); }); fetchOptions.body = fd; }
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else { fetchOptions.body = JSON.stringify(body); }
    }
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new HybridAnalysisApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

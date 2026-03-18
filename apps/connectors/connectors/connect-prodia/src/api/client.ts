import type { ProdiaConfig } from '../types';
import { ProdiaApiError } from '../types';
const DEFAULT_BASE_URL = 'https://api.prodia.com/v1';
export class ProdiaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(config: ProdiaConfig) {
    if (!config.apiKey) throw new Error('Prodia API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { 'X-Prodia-Key': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && method === 'POST') fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ProdiaApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}

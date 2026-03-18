import type { JinaAIConfig } from '../types';
import { JinaAIApiError } from '../types';

export class JinaAIClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.jina.ai/v1';

  constructor(config: JinaAIConfig) {
    if (!config.apiKey) throw new Error('Jina AI apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'POST', body } = options;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new JinaAIApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    return data as T;
  }

  async readerRequest<T>(url: string): Promise<T> {
    const response = await fetch(`https://r.jina.ai/${url}`, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new JinaAIApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    return data as T;
  }
}

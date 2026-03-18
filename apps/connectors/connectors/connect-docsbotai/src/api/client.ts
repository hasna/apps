import type { DocsBotConfig } from '../types';
import { DocsBotApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.docsbot.ai/teams';

export class DocsBotClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: DocsBotConfig) {
    if (!config.apiKey) throw new Error('DocsBot API key is required');
    this.apiKey = config.apiKey;
    const teamId = config.teamId || 'default';
    this.baseUrl = config.baseUrl || `${DEFAULT_BASE_URL}/${teamId}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new DocsBotApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

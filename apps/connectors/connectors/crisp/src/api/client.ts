import type { CrispConfig } from '../types';
import { CrispApiError } from '../types';

export class CrispClient {
  private readonly authHeader: string;
  private readonly websiteId: string;
  private readonly baseUrl = 'https://api.crisp.chat/v1';

  constructor(config: CrispConfig) {
    if (!config.websiteId || !config.tokenId || !config.tokenKey) throw new Error('Crisp websiteId, tokenId, and tokenKey are required');
    this.authHeader = `Basic ${btoa(`${config.tokenId}:${config.tokenKey}`)}`;
    this.websiteId = config.websiteId;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({})) as { error?: boolean; reason?: string; data?: unknown };
    if (!response.ok || data.error) throw new CrispApiError(data.reason || response.statusText, response.status);
    return (data.data ?? data) as T;
  }

  getWebsiteId(): string { return this.websiteId; }
}

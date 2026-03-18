import type { RocketChatConfig } from '../types';
import { RocketChatApiError } from '../types';

export class RocketChatClient {
  private readonly authToken: string;
  private readonly userId: string;
  private readonly baseUrl: string;

  constructor(config: RocketChatConfig) {
    if (!config.url || !config.authToken || !config.userId) throw new Error('Rocket.Chat url, authToken, and userId are required');
    this.authToken = config.authToken;
    this.userId = config.userId;
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api/v1`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-Auth-Token': this.authToken, 'X-User-Id': this.userId, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string; [key: string]: unknown };
    if (!response.ok || data.success === false) throw new RocketChatApiError(data.error || response.statusText, response.status);
    return data as T;
  }
}

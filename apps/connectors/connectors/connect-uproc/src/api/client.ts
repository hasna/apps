import type { UProcConfig } from '../types';
import { UProcApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.uproc.io/api/v2';

export class UProcClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: UProcConfig) {
    if (!config.email || !config.apiKey) throw new Error('uProc email and apiKey are required');
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString('base64')}`;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const method = body ? 'POST' : 'GET';
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new UProcApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}

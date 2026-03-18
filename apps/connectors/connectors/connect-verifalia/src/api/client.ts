import type { VerifaliaConfig } from '../types';
import { VerifaliaApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.verifalia.com/v2.5';

export class VerifaliaClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: VerifaliaConfig) {
    if (!config.username || !config.password) throw new Error('Verifalia username and password are required');
    this.authHeader = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    if (response.status === 202 || response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { type?: string; title?: string })?.title || response.statusText;
      throw new VerifaliaApiError(msg, response.status);
    }
    return data as T;
  }
}

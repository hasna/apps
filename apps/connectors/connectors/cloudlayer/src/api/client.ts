import type { CloudLayerConfig } from '../types';
import { CloudLayerApiError } from '../types';

export class CloudLayerClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://app.cloudlayer.io/api/v1';

  constructor(config: CloudLayerConfig) {
    if (!config.apiKey) throw new Error('CloudLayer apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CloudLayerApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}

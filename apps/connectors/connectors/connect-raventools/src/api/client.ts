import type { RavenToolsConfig } from '../types';
import { RavenToolsApiError } from '../types';

// Raven Tools uses token as a query param, not a header
const DEFAULT_BASE_URL = 'https://api.raven.tools/1.0';

export class RavenToolsClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: RavenToolsConfig) {
    if (!config.token) throw new Error('Raven Tools API token is required');
    this.token = config.token;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    // Raven Tools auth is via token query param
    url.searchParams.append('token', this.token);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.append(k, String(v));
    });

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { error?: string; message?: string })?.error || response.statusText;
      throw new RavenToolsApiError(msg, response.status);
    }
    return data as T;
  }

  getTokenPreview(): string {
    return `${this.token.substring(0, 8)}...`;
  }
}

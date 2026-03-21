import type { ConnectorConfig } from '../types';
import { ConnectorApiError } from '../types';

// Brandsight API base URL
const API_BASE = 'https://api.brandsight.com/v1';

/**
 * Low-level HTTP client for the Brandsight REST API.
 * Handles URL building, Bearer auth, and JSON error checking.
 */
export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = API_BASE;
  }

  /**
   * Build a full Brandsight API URL for a given path
   */
  buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Make an authenticated GET request to the Brandsight API.
   * Returns parsed JSON on success, or { stub: true } when API is unreachable.
   */
  async request<T>(path: string): Promise<{ data: T; stub: false } | { data: null; stub: true }> {
    const url = this.buildUrl(path);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'connect-brandsight/0.1.0',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new ConnectorApiError(
          `Brandsight API GET ${path} failed with status ${response.status}`,
          response.status,
          await response.text()
        );
      }

      const data = (await response.json()) as T;
      return { data, stub: false };
    } catch (error) {
      if (error instanceof ConnectorApiError) throw error;
      // API unreachable — return stub indicator
      return { data: null, stub: true };
    }
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

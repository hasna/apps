import type { SpecificConfig, GraphQLResponse } from '../types';
import { SpecificApiError } from '../types';

// Specific public GraphQL API endpoint
const DEFAULT_BASE_URL = 'https://public-api.specific.app/graphql';

/**
 * Low-level GraphQL client for the Specific public API.
 *
 * Authentication: the personal API key is sent RAW in the `Authorization`
 * header (no `Bearer ` prefix), matching the documented format.
 */
export class SpecificClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SpecificConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Execute a GraphQL operation and return the `data` payload.
   * Throws SpecificApiError on transport failures or GraphQL `errors`.
   */
  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const requestHeaders: Record<string, string> = {
      // Specific expects the raw API key, NOT a Bearer token.
      'Authorization': this.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ query, variables }),
    });

    let payload: GraphQLResponse<T> | undefined;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text) as GraphQLResponse<T>;
      } catch {
        payload = undefined;
      }
    }

    if (!response.ok) {
      const message = payload?.errors?.map((e) => e.message).join('; ')
        || text
        || response.statusText;
      throw new SpecificApiError(message, response.status, payload?.errors);
    }

    if (payload?.errors && payload.errors.length > 0) {
      const message = payload.errors.map((e) => e.message).join('; ');
      throw new SpecificApiError(message, response.status, payload.errors);
    }

    if (!payload || payload.data === undefined) {
      throw new SpecificApiError('Empty GraphQL response', response.status);
    }

    return payload.data;
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

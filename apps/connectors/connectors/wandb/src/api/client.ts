import type { WandbConfig, GraphQLResponse } from '../types';
import { WandbApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.wandb.ai/graphql';

export class WandbClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WandbConfig) {
    if (!config.apiKey) {
      throw new Error('W&B API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Execute a GraphQL query or mutation against the W&B API.
   */
  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new WandbApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        'http_error',
        response.status
      );
    }

    const result = await response.json() as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      const error = result.errors[0];
      throw new WandbApiError(
        error.message,
        (error.extensions?.code as string) || 'graphql_error'
      );
    }

    if (!result.data) {
      throw new WandbApiError('No data returned', 'no_data');
    }

    return result.data;
  }

  /**
   * Send a raw JSON body to the GraphQL endpoint (for advanced use).
   */
  async raw<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new WandbApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        'http_error',
        response.status
      );
    }

    return await response.json() as T;
  }
}

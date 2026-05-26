import type { LinearConfig, GraphQLResponse } from '../types';
import { LinearApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.linear.app/graphql';

export class LinearClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: LinearConfig) {
    if (!config.apiKey) {
      throw new Error('Linear API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Execute a GraphQL query
   */
  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new LinearApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        'http_error',
        response.status
      );
    }

    const result = await response.json() as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      const error = result.errors[0];
      throw new LinearApiError(
        error.message,
        error.extensions?.code as string || 'graphql_error'
      );
    }

    if (!result.data) {
      throw new LinearApiError('No data returned', 'no_data');
    }

    return result.data;
  }

  /**
   * Execute a GraphQL mutation
   */
  async mutate<T>(mutation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.query<T>(mutation, variables);
  }
}

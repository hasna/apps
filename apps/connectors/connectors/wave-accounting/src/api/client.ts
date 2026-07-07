import type { GraphQLResponse, WaveAccountingConfig } from '../types';
import { WaveApiError } from '../types';

const DEFAULT_BASE_URL = 'https://gql.waveapps.com/graphql/public';

export class WaveGraphQLClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: WaveAccountingConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    let data: GraphQLResponse<T>;
    try {
      data = await response.json() as GraphQLResponse<T>;
    } catch {
      throw new WaveApiError(
        `Invalid JSON response (HTTP ${response.status})`,
        response.status
      );
    }

    if (data.errors && data.errors.length > 0) {
      throw new WaveApiError(
        data.errors[0].message,
        response.status,
        data.errors
      );
    }

    if (!response.ok) {
      throw new WaveApiError('Request failed', response.status, data.errors);
    }

    if (!data.data) {
      throw new WaveApiError('No data returned', response.status);
    }

    return data.data;
  }

  async mutation<T>(mutation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.query<T>(mutation, variables);
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}

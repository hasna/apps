import type { MondayConfig, MondayGraphQLResponse, MondayError } from '../types';
import { MondayApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.monday.com/v2';

export class MondayClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: MondayConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
        'API-Version': '2024-01',
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await response.json() as MondayGraphQLResponse<T>;

    if (data.errors && data.errors.length > 0) {
      throw new MondayApiError(
        data.errors[0].message,
        response.status,
        data.errors
      );
    }

    if (!response.ok) {
      throw new MondayApiError(
        'Request failed',
        response.status
      );
    }

    return data.data as T;
  }

  async mutation<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.query<T>(query, variables);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

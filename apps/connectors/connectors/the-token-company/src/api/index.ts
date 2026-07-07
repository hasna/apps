import type { TheTokenCompanyConfig, RawRequestOptions } from '../types';
import { TheTokenCompanyClient } from './client';
import { CompressApi } from './compress';

/**
 * The Token Company API client for LLM prompt compression.
 */
export class TheTokenCompany {
  private readonly client: TheTokenCompanyClient;

  public readonly compress: CompressApi;

  constructor(config: TheTokenCompanyConfig) {
    this.client = new TheTokenCompanyClient(config);
    this.compress = new CompressApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Looks for THE_TOKEN_COMPANY_API_KEY and optional THE_TOKEN_COMPANY_BASE_URL.
   */
  static fromEnv(): TheTokenCompany {
    const apiKey = process.env.THE_TOKEN_COMPANY_API_KEY;

    if (!apiKey) {
      throw new Error('THE_TOKEN_COMPANY_API_KEY environment variable is required');
    }

    return new TheTokenCompany({
      apiKey,
      baseUrl: process.env.THE_TOKEN_COMPANY_BASE_URL,
    });
  }

  /**
   * Call any API path with arbitrary method and body.
   */
  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, body, query } = options;
    return this.client.request<T>(path, { method, body, params: query });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): TheTokenCompanyClient {
    return this.client;
  }
}

export const Connector = TheTokenCompany;

export { TheTokenCompanyClient } from './client';
export { CompressApi } from './compress';

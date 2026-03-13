import type { GoogleAdsConfig, SearchResponse, MutateResponse, GoogleAdsError as GoogleAdsErrorType } from '../types';
import { GoogleAdsError } from '../types';

const DEFAULT_API_VERSION = 'v20';
const BASE_URL = 'https://googleads.googleapis.com';

export class GoogleAdsClient {
  private accessToken?: string;
  private developerToken?: string;
  private customerId?: string;
  private loginCustomerId?: string;
  private apiVersion: string;

  constructor(config: GoogleAdsConfig) {
    this.accessToken = config.accessToken;
    this.developerToken = config.developerToken;
    this.customerId = config.customerId;
    this.loginCustomerId = config.loginCustomerId;
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    if (this.loginCustomerId) {
      headers['login-customer-id'] = this.loginCustomerId;
    }

    return headers;
  }

  private getCustomerId(): string {
    if (!this.customerId) {
      throw new Error('Customer ID not set. Use --customer or set default with "connect-googleads config set-customer"');
    }
    return this.customerId.replace(/-/g, '');
  }

  setCustomerId(customerId: string): void {
    this.customerId = customerId.replace(/-/g, '');
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));

      if (errorBody.error) {
        const details = errorBody.error.details?.[0];
        throw new GoogleAdsError(
          errorBody.error.message,
          errorBody.error.code,
          details?.errors,
          details?.requestId
        );
      }

      throw new GoogleAdsError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    return response.json();
  }

  /**
   * Execute a Google Ads Query Language (GAQL) query
   */
  async search(query: string, pageSize = 10000, pageToken?: string): Promise<SearchResponse> {
    const customerId = this.getCustomerId();
    const url = `${BASE_URL}/${this.apiVersion}/customers/${customerId}/googleAds:search`;

    const body: Record<string, unknown> = {
      query,
      pageSize,
    };

    if (pageToken) {
      body.pageToken = pageToken;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    return this.handleResponse<SearchResponse>(response);
  }

  /**
   * Execute a streaming search query (returns all results)
   */
  async searchStream(query: string): Promise<SearchResponse> {
    const customerId = this.getCustomerId();
    const url = `${BASE_URL}/${this.apiVersion}/customers/${customerId}/googleAds:searchStream`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ query }),
    });

    // searchStream returns an array of responses
    const results = await this.handleResponse<SearchResponse[]>(response);

    // Combine all results
    const combined: SearchResponse = {
      results: [],
    };

    for (const result of results) {
      if (result.results) {
        combined.results.push(...result.results);
      }
    }

    return combined;
  }

  /**
   * Mutate resources (create, update, delete)
   */
  async mutate(
    resourceType: string,
    operations: Array<{ create?: unknown; update?: unknown; remove?: string; updateMask?: string }>,
    options?: { partialFailure?: boolean; validateOnly?: boolean }
  ): Promise<MutateResponse> {
    const customerId = this.getCustomerId();
    const url = `${BASE_URL}/${this.apiVersion}/customers/${customerId}/${resourceType}:mutate`;

    const body: Record<string, unknown> = {
      operations,
    };

    if (options?.partialFailure) {
      body.partialFailure = true;
    }

    if (options?.validateOnly) {
      body.validateOnly = true;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    return this.handleResponse<MutateResponse>(response);
  }

  /**
   * Get customer details
   */
  async getCustomer(): Promise<SearchResponse> {
    return this.search(`
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.auto_tagging_enabled,
        customer.manager,
        customer.test_account
      FROM customer
      LIMIT 1
    `);
  }

  /**
   * List accessible customers (manager accounts)
   */
  async listAccessibleCustomers(): Promise<{ resourceNames: string[] }> {
    const url = `${BASE_URL}/${this.apiVersion}/customers:listAccessibleCustomers`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<{ resourceNames: string[] }>(response);
  }

  /**
   * Get customer client accounts (for manager accounts)
   */
  async getCustomerClients(): Promise<SearchResponse> {
    return this.search(`
      SELECT
        customer_client.client_customer,
        customer_client.level,
        customer_client.manager,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.id,
        customer_client.test_account,
        customer_client.hidden
      FROM customer_client
      WHERE customer_client.level <= 1
    `);
  }
}

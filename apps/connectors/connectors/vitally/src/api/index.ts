// Vitally Connector - customer success platform REST API

import { VitallyClient } from './client';
import type {
  VitallyConfig,
  VitallyListResponse,
  VitallyAccount,
  CreateAccountInput,
  VitallyEvent,
  VitallySearchRequest,
  VitallySearchResponse,
} from '../types';

export { VitallyClient, buildBasicAuthHeader, resolveBaseUrl } from './client';

export class Vitally {
  private client: VitallyClient;

  constructor(config: VitallyConfig) {
    this.client = new VitallyClient(config);
  }

  /** List accounts (paginated). */
  async listAccounts(params?: {
    from?: string;
    limit?: number;
  }): Promise<VitallyListResponse<VitallyAccount>> {
    return this.client.get('/resources/accounts', params);
  }

  /** Get an account by Vitally ID or external ID. */
  async getAccount(accountId: string): Promise<VitallyAccount> {
    return this.client.get(`/resources/accounts/${encodeURIComponent(accountId)}`);
  }

  /** Create or upsert an account. */
  async createAccount(data: CreateAccountInput): Promise<VitallyAccount> {
    return this.client.post('/resources/accounts', data);
  }

  /** List tracked product events. */
  async listEvents(params?: {
    from?: string;
    limit?: number;
    accountId?: string;
    userId?: string;
  }): Promise<VitallyListResponse<VitallyEvent>> {
    return this.client.get('/resources/events', params);
  }

  /** Search across Vitally resources. */
  async search<T = unknown>(request: VitallySearchRequest): Promise<VitallySearchResponse<T>> {
    return this.client.post('/resources/search', request);
  }

  /** Escape hatch for undocumented or beta endpoints. */
  async rawRequest<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
    }
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}

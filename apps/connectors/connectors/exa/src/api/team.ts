import type { ExaClient } from './client';
import type {
  ApiKey,
  ApiKeyCreateOptions,
  ApiKeyUpdateOptions,
  ApiKeyUsage,
  ApiKeyListResponse,
} from '../types';

/**
 * Team API - API key management
 */
export class TeamApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * List all API keys
   */
  async listKeys(): Promise<ApiKeyListResponse> {
    return this.client.get<ApiKeyListResponse>('/team/api-keys');
  }

  /**
   * Create a new API key
   */
  async createKey(options: ApiKeyCreateOptions): Promise<ApiKey> {
    const body: Record<string, unknown> = {
      name: options.name,
    };

    if (options.rateLimit !== undefined) {
      body.rateLimit = options.rateLimit;
    }
    if (options.monthlyLimit !== undefined) {
      body.monthlyLimit = options.monthlyLimit;
    }

    return this.client.post<ApiKey>('/team/api-keys', body);
  }

  /**
   * Get an API key by ID
   */
  async getKey(keyId: string): Promise<ApiKey> {
    return this.client.get<ApiKey>(`/team/api-keys/${keyId}`);
  }

  /**
   * Update an API key
   */
  async updateKey(keyId: string, options: ApiKeyUpdateOptions): Promise<ApiKey> {
    const body: Record<string, unknown> = {};

    if (options.name !== undefined) {
      body.name = options.name;
    }
    if (options.rateLimit !== undefined) {
      body.rateLimit = options.rateLimit;
    }
    if (options.monthlyLimit !== undefined) {
      body.monthlyLimit = options.monthlyLimit;
    }

    return this.client.patch<ApiKey>(`/team/api-keys/${keyId}`, body);
  }

  /**
   * Delete an API key
   */
  async deleteKey(keyId: string): Promise<void> {
    await this.client.delete<void>(`/team/api-keys/${keyId}`);
  }

  /**
   * Get usage for an API key
   */
  async getKeyUsage(keyId: string, period?: string): Promise<ApiKeyUsage> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (period) {
      params.period = period;
    }

    return this.client.get<ApiKeyUsage>(`/team/api-keys/${keyId}/usage`, params);
  }

  /**
   * Get usage for all API keys
   */
  async getAllUsage(period?: string): Promise<ApiKeyUsage[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (period) {
      params.period = period;
    }

    const response = await this.client.get<{ usage: ApiKeyUsage[] }>('/team/usage', params);
    return response.usage;
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Create a key with rate limiting
   */
  async createRateLimitedKey(name: string, rateLimit: number): Promise<ApiKey> {
    return this.createKey({ name, rateLimit });
  }

  /**
   * Create a key with monthly limit
   */
  async createMonthlyLimitedKey(name: string, monthlyLimit: number): Promise<ApiKey> {
    return this.createKey({ name, monthlyLimit });
  }

  /**
   * Create a fully limited key
   */
  async createLimitedKey(
    name: string,
    rateLimit: number,
    monthlyLimit: number
  ): Promise<ApiKey> {
    return this.createKey({ name, rateLimit, monthlyLimit });
  }

  /**
   * Rename an API key
   */
  async renameKey(keyId: string, name: string): Promise<ApiKey> {
    return this.updateKey(keyId, { name });
  }

  /**
   * Update rate limit for an API key
   */
  async updateRateLimit(keyId: string, rateLimit: number): Promise<ApiKey> {
    return this.updateKey(keyId, { rateLimit });
  }

  /**
   * Update monthly limit for an API key
   */
  async updateMonthlyLimit(keyId: string, monthlyLimit: number): Promise<ApiKey> {
    return this.updateKey(keyId, { monthlyLimit });
  }

  /**
   * List keys and their usage
   */
  async listKeysWithUsage(period?: string): Promise<Array<ApiKey & { usage?: ApiKeyUsage }>> {
    const [keysResponse, usageList] = await Promise.all([
      this.listKeys(),
      this.getAllUsage(period),
    ]);

    const usageMap = new Map(usageList.map(u => [u.keyId, u]));

    return keysResponse.keys.map(key => ({
      ...key,
      usage: usageMap.get(key.id),
    }));
  }
}

import type { ResendClient } from './client';
import type {
  ApiKey,
  ApiKeyWithToken,
  CreateApiKeyParams,
  ListResponse,
} from '../types';

/**
 * API Keys API - Create, list, and delete API keys
 * https://resend.com/docs/api-reference/api-keys
 */
export class ApiKeysApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Create a new API key
   * POST /api-keys
   * Note: The token is only returned once upon creation
   */
  async create(params: CreateApiKeyParams): Promise<ApiKeyWithToken> {
    return this.client.post<ApiKeyWithToken>('/api-keys', params);
  }

  /**
   * List all API keys
   * GET /api-keys
   * Note: Tokens are not returned in the list
   */
  async list(): Promise<ListResponse<ApiKey>> {
    return this.client.get<ListResponse<ApiKey>>('/api-keys');
  }

  /**
   * Delete an API key
   * DELETE /api-keys/:id
   */
  async delete(apiKeyId: string): Promise<void> {
    await this.client.delete(`/api-keys/${apiKeyId}`);
  }
}

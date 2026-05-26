import type { CloudflareClient } from './client';
import type { KVNamespace, KVKey, CreateKVNamespaceParams, ListKVKeysParams, WriteKVParams, BulkWriteKVParams, CloudflareResponse } from '../types';

export class KVApi {
  constructor(private client: CloudflareClient) {}

  // ============================================
  // Namespaces
  // ============================================

  /**
   * List all KV namespaces for an account
   */
  async listNamespaces(
    accountId: string,
    params?: {
      page?: number;
      per_page?: number;
      order?: 'id' | 'title';
      direction?: 'asc' | 'desc';
    }
  ): Promise<CloudflareResponse<KVNamespace[]>> {
    return this.client.get<KVNamespace[]>(
      `/accounts/${accountId}/storage/kv/namespaces`,
      params
    );
  }

  /**
   * Get a KV namespace
   */
  async getNamespace(accountId: string, namespaceId: string): Promise<KVNamespace> {
    const response = await this.client.get<KVNamespace>(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`
    );
    return response.result;
  }

  /**
   * Create a KV namespace
   */
  async createNamespace(accountId: string, params: CreateKVNamespaceParams): Promise<KVNamespace> {
    const response = await this.client.post<KVNamespace>(
      `/accounts/${accountId}/storage/kv/namespaces`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Rename a KV namespace
   */
  async renameNamespace(accountId: string, namespaceId: string, title: string): Promise<void> {
    await this.client.put(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`,
      { title }
    );
  }

  /**
   * Delete a KV namespace
   */
  async deleteNamespace(accountId: string, namespaceId: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`);
  }

  // ============================================
  // Keys
  // ============================================

  /**
   * List keys in a KV namespace
   */
  async listKeys(
    accountId: string,
    namespaceId: string,
    params?: ListKVKeysParams
  ): Promise<CloudflareResponse<KVKey[]>> {
    return this.client.get<KVKey[]>(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`,
      params as Record<string, string | number | boolean | undefined> | undefined
    );
  }

  /**
   * Get metadata for a specific key
   */
  async getKeyMetadata(
    accountId: string,
    namespaceId: string,
    key: string
  ): Promise<{ name: string; expiration?: number; metadata?: Record<string, unknown> }> {
    const response = await this.client.get<{ name: string; expiration?: number; metadata?: Record<string, unknown> }>(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/metadata/${encodeURIComponent(key)}`
    );
    return response.result;
  }

  // ============================================
  // Values
  // ============================================

  /**
   * Read a value from KV
   */
  async get(accountId: string, namespaceId: string, key: string): Promise<string> {
    return this.client.request<string>(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      { method: 'GET' }
    );
  }

  /**
   * Write a value to KV
   */
  async put(accountId: string, namespaceId: string, params: WriteKVParams): Promise<void> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params.expiration) {
      queryParams.expiration = params.expiration;
    }
    if (params.expiration_ttl) {
      queryParams.expiration_ttl = params.expiration_ttl;
    }

    await this.client.request(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(params.key)}`,
      {
        method: 'PUT',
        body: params.value,
        params: queryParams,
        rawBody: true,
        headers: {
          'Content-Type': 'text/plain',
        },
      }
    );
  }

  /**
   * Delete a key-value pair from KV
   */
  async delete(accountId: string, namespaceId: string, key: string): Promise<void> {
    await this.client.delete(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`
    );
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Write multiple key-value pairs to KV
   */
  async bulkWrite(accountId: string, namespaceId: string, items: BulkWriteKVParams[]): Promise<void> {
    await this.client.put(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
      items as unknown as Record<string, unknown>
    );
  }

  /**
   * Delete multiple keys from KV
   */
  async bulkDelete(accountId: string, namespaceId: string, keys: string[]): Promise<void> {
    await this.client.delete(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
      { keys: keys.join(',') }
    );
  }
}

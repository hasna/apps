import { TypesenseClient } from './client';
import type {
  TypesenseAlias,
  TypesenseApiKey,
  TypesenseCollection,
  TypesenseConfig,
  TypesenseHealth,
  TypesenseSearchResult,
} from '../types';
import {
  requireInteger,
  requireRecord,
  requireRecordArray,
  requireString,
  requireStringArray,
} from '../types';

export { TypesenseClient, buildQuery } from './client';

export class Typesense {
  private readonly client: TypesenseClient;

  constructor(config: TypesenseConfig) {
    this.client = new TypesenseClient(config);
  }

  static fromEnv(): Typesense {
    const host = process.env.TYPESENSE_HOST;
    const apiKey = process.env.TYPESENSE_API_KEY;
    if (!host) throw new Error('TYPESENSE_HOST is required');
    if (!apiKey) throw new Error('TYPESENSE_API_KEY is required');
    return new Typesense({ host, apiKey });
  }

  // Health & ops
  async getHealth(): Promise<TypesenseHealth> {
    return this.client.request<TypesenseHealth>('/health');
  }

  async getDebug(): Promise<Record<string, unknown>> {
    return this.client.request('/debug');
  }

  async getStats(): Promise<Record<string, unknown>> {
    return this.client.request('/stats.json');
  }

  async getMetrics(): Promise<Record<string, unknown>> {
    return this.client.request('/metrics.json');
  }

  // Collections
  async listCollections(): Promise<TypesenseCollection[]> {
    return this.client.request('/collections');
  }

  async getCollection(name: string): Promise<TypesenseCollection> {
    const n = requireString(name, 'name');
    return this.client.request(`/collections/${encodeURIComponent(n)}`);
  }

  async createCollection(schema: Record<string, unknown>): Promise<TypesenseCollection> {
    return this.client.request('/collections', { method: 'POST', body: requireRecord(schema, 'schema') });
  }

  async updateCollection(name: string, schema: Record<string, unknown>): Promise<TypesenseCollection> {
    const n = requireString(name, 'name');
    return this.client.request(`/collections/${encodeURIComponent(n)}`, {
      method: 'PATCH',
      body: requireRecord(schema, 'schema'),
    });
  }

  async dropCollection(name: string, compactStore?: boolean): Promise<TypesenseCollection> {
    const n = requireString(name, 'name');
    return this.client.request(`/collections/${encodeURIComponent(n)}`, {
      method: 'DELETE',
      params: { compact_store: compactStore },
    });
  }

  async truncateCollection(name: string): Promise<Record<string, unknown>> {
    const n = requireString(name, 'name');
    return this.client.request(`/collections/${encodeURIComponent(n)}/documents`, {
      method: 'DELETE',
      params: { truncate: true },
    });
  }

  async getSchemaChanges(): Promise<Record<string, unknown>> {
    return this.client.request('/operations/schema_changes');
  }

  // Documents
  async createDocument(
    collection: string,
    document: Record<string, unknown>,
    action?: 'create' | 'upsert' | 'update' | 'emplace',
  ): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    return this.client.request(`/collections/${encodeURIComponent(c)}/documents`, {
      method: 'POST',
      body: requireRecord(document, 'document'),
      params: { action },
    });
  }

  async getDocument(collection: string, id: string): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    const docId = requireString(id, 'id');
    return this.client.request(`/collections/${encodeURIComponent(c)}/documents/${encodeURIComponent(docId)}`);
  }

  async updateDocument(
    collection: string,
    id: string,
    document: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    const docId = requireString(id, 'id');
    return this.client.request(`/collections/${encodeURIComponent(c)}/documents/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      body: requireRecord(document, 'document'),
    });
  }

  async deleteDocument(collection: string, id: string): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    const docId = requireString(id, 'id');
    return this.client.request(`/collections/${encodeURIComponent(c)}/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    });
  }

  async importDocuments(
    collection: string,
    jsonlBody: string,
    options?: { action?: 'create' | 'upsert' | 'update' | 'emplace'; batchSize?: number; returnId?: boolean },
  ): Promise<string> {
    const c = requireString(collection, 'collection');
    const body = requireString(jsonlBody, 'jsonlBody');
    return this.client.requestText(`/collections/${encodeURIComponent(c)}/documents/import`, {
      method: 'POST',
      body,
      contentType: 'text/plain',
      params: {
        action: options?.action,
        batch_size: options?.batchSize,
        return_id: options?.returnId,
      },
    });
  }

  async exportDocuments(
    collection: string,
    options?: { filterBy?: string; includeFields?: string; excludeFields?: string },
  ): Promise<string> {
    const c = requireString(collection, 'collection');
    return this.client.requestText(`/collections/${encodeURIComponent(c)}/documents/export`, {
      params: {
        filter_by: options?.filterBy,
        include_fields: options?.includeFields,
        exclude_fields: options?.excludeFields,
      },
    });
  }

  // Search
  async search(
    collection: string,
    options: {
      q: string;
      queryBy: string;
      filterBy?: string;
      sortBy?: string;
      facetBy?: string;
      page?: number;
      perPage?: number;
      includeFields?: string;
      excludeFields?: string;
      vectorQuery?: string;
    },
  ): Promise<TypesenseSearchResult> {
    const c = requireString(collection, 'collection');
    return this.client.request(`/collections/${encodeURIComponent(c)}/documents/search`, {
      params: {
        q: requireString(options.q, 'q'),
        query_by: requireString(options.queryBy, 'queryBy'),
        filter_by: options.filterBy,
        sort_by: options.sortBy,
        facet_by: options.facetBy,
        page: options.page,
        per_page: options.perPage,
        include_fields: options.includeFields,
        exclude_fields: options.excludeFields,
        vector_query: options.vectorQuery,
      },
    });
  }

  async multiSearch(
    searches: Array<Record<string, unknown>>,
    commonParams?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { searches: requireRecordArray(searches, 'searches') };
    if (commonParams !== undefined) {
      body.common_params = requireRecord(commonParams, 'commonParams');
    }
    return this.client.request('/multi_search', { method: 'POST', body });
  }

  // API keys
  async listApiKeys(): Promise<{ keys: TypesenseApiKey[] }> {
    return this.client.request('/keys');
  }

  async createApiKey(options: {
    description: string;
    actions: string[];
    collections: string[];
    expiresAt?: number;
  }): Promise<TypesenseApiKey> {
    const body: Record<string, unknown> = {
      description: requireString(options.description, 'description'),
      actions: requireStringArray(options.actions, 'actions'),
      collections: requireStringArray(options.collections, 'collections'),
    };
    if (options.expiresAt !== undefined) body.expires_at = options.expiresAt;
    return this.client.request('/keys', { method: 'POST', body });
  }

  async getApiKey(id: number): Promise<TypesenseApiKey> {
    const keyId = requireInteger(id, 'id');
    return this.client.request(`/keys/${keyId}`);
  }

  async deleteApiKey(id: number): Promise<TypesenseApiKey> {
    const keyId = requireInteger(id, 'id');
    return this.client.request(`/keys/${keyId}`, { method: 'DELETE' });
  }

  // Aliases
  async listAliases(): Promise<{ aliases: TypesenseAlias[] }> {
    return this.client.request('/aliases');
  }

  async upsertAlias(alias: string, collectionName: string): Promise<TypesenseAlias> {
    const a = requireString(alias, 'alias');
    const name = requireString(collectionName, 'collectionName');
    return this.client.request(`/aliases/${encodeURIComponent(a)}`, {
      method: 'PUT',
      body: { collection_name: name },
    });
  }

  async getAlias(alias: string): Promise<TypesenseAlias> {
    const a = requireString(alias, 'alias');
    return this.client.request(`/aliases/${encodeURIComponent(a)}`);
  }

  async deleteAlias(alias: string): Promise<TypesenseAlias> {
    const a = requireString(alias, 'alias');
    return this.client.request(`/aliases/${encodeURIComponent(a)}`, { method: 'DELETE' });
  }

  // Synonyms
  async listSynonyms(collection: string): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    return this.client.request(`/collections/${encodeURIComponent(c)}/synonyms`);
  }

  async upsertSynonym(
    collection: string,
    synonymId: string,
    synonyms: string[],
    root?: string,
  ): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    const id = requireString(synonymId, 'synonymId');
    const body: Record<string, unknown> = { synonyms: requireStringArray(synonyms, 'synonyms') };
    if (root) body.root = root;
    return this.client.request(`/collections/${encodeURIComponent(c)}/synonyms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body,
    });
  }

  async deleteSynonym(collection: string, synonymId: string): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    const id = requireString(synonymId, 'synonymId');
    return this.client.request(`/collections/${encodeURIComponent(c)}/synonyms/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Overrides
  async listOverrides(collection: string): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    return this.client.request(`/collections/${encodeURIComponent(c)}/overrides`);
  }

  async upsertOverride(
    collection: string,
    overrideId: string,
    rule: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const c = requireString(collection, 'collection');
    const id = requireString(overrideId, 'overrideId');
    return this.client.request(`/collections/${encodeURIComponent(c)}/overrides/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: requireRecord(rule, 'rule'),
    });
  }

  getClient(): TypesenseClient {
    return this.client;
  }
}

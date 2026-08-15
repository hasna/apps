import type { WebflowClient } from './client';
import type { Collection, CreateCollectionInput } from '../types';

/**
 * Webflow Collections API
 */
export class CollectionsApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all collections for a site
   */
  async list(siteId: string): Promise<Collection[]> {
    const response = await this.client.request<{ collections: Collection[] }>(
      `/sites/${siteId}/collections`
    );
    return response.collections;
  }

  /**
   * Get a single collection by ID
   */
  async get(collectionId: string): Promise<Collection> {
    return this.client.request<Collection>(`/collections/${collectionId}`);
  }

  /**
   * Create a new collection
   */
  async create(siteId: string, collection: CreateCollectionInput): Promise<Collection> {
    return this.client.request<Collection>(
      `/sites/${siteId}/collections`,
      { method: 'POST', body: collection }
    );
  }

  /**
   * Delete a collection
   */
  async delete(collectionId: string): Promise<void> {
    await this.client.request<void>(
      `/collections/${collectionId}`,
      { method: 'DELETE' }
    );
  }
}

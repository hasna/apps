import type { ShopifyClient } from './client';
import type { Collection, CreateCollectionRequest, UpdateCollectionRequest, CollectionRule, CollectionImage } from '../types';

export interface ListCollectionsOptions {
  limit?: number;
  sinceId?: number;
  productId?: number;
  handle?: string;
  updatedAtMin?: string;
  updatedAtMax?: string;
  publishedAtMin?: string;
  publishedAtMax?: string;
  publishedStatus?: 'published' | 'unpublished' | 'any';
  fields?: string;
  ids?: string;
}

/**
 * Shopify Collections API
 * Supports both Custom Collections and Smart Collections
 */
export class CollectionsApi {
  constructor(private readonly client: ShopifyClient) {}

  // ============================================
  // Custom Collections
  // ============================================

  /**
   * List custom collections
   */
  async listCustom(options: ListCollectionsOptions = {}): Promise<Collection[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 50,
    };

    if (options.sinceId) params.since_id = options.sinceId;
    if (options.productId) params.product_id = options.productId;
    if (options.handle) params.handle = options.handle;
    if (options.updatedAtMin) params.updated_at_min = options.updatedAtMin;
    if (options.updatedAtMax) params.updated_at_max = options.updatedAtMax;
    if (options.publishedAtMin) params.published_at_min = options.publishedAtMin;
    if (options.publishedAtMax) params.published_at_max = options.publishedAtMax;
    if (options.publishedStatus) params.published_status = options.publishedStatus;
    if (options.fields) params.fields = options.fields;
    if (options.ids) params.ids = options.ids;

    const response = await this.client.request<{ custom_collections: Record<string, unknown>[] }>(
      '/custom_collections.json',
      { params }
    );

    return this.transformCollections(response.custom_collections);
  }

  /**
   * Get a custom collection by ID
   */
  async getCustom(id: number, fields?: string): Promise<Collection> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params.fields = fields;

    const response = await this.client.request<{ custom_collection: Record<string, unknown> }>(
      `/custom_collections/${id}.json`,
      { params }
    );

    return this.transformCollection(response.custom_collection);
  }

  /**
   * Get custom collection count
   */
  async countCustom(productId?: number): Promise<number> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (productId) params.product_id = productId;

    const response = await this.client.request<{ count: number }>(
      '/custom_collections/count.json',
      { params }
    );

    return response.count;
  }

  /**
   * Create a custom collection
   */
  async createCustom(collection: CreateCollectionRequest): Promise<Collection> {
    const body = {
      custom_collection: {
        title: collection.title,
        body_html: collection.bodyHtml,
        handle: collection.handle,
        image: collection.image ? {
          src: collection.image.src,
          alt: collection.image.alt,
        } : undefined,
        published: collection.published,
        sort_order: collection.sortOrder,
        template_suffix: collection.templateSuffix,
      },
    };

    const response = await this.client.request<{ custom_collection: Record<string, unknown> }>(
      '/custom_collections.json',
      { method: 'POST', body }
    );

    return this.transformCollection(response.custom_collection);
  }

  /**
   * Update a custom collection
   */
  async updateCustom(id: number, collection: UpdateCollectionRequest): Promise<Collection> {
    const body = {
      custom_collection: {
        id,
        title: collection.title,
        body_html: collection.bodyHtml,
        handle: collection.handle,
        image: collection.image ? {
          src: collection.image.src,
          alt: collection.image.alt,
        } : undefined,
        sort_order: collection.sortOrder,
        template_suffix: collection.templateSuffix,
      },
    };

    const response = await this.client.request<{ custom_collection: Record<string, unknown> }>(
      `/custom_collections/${id}.json`,
      { method: 'PUT', body }
    );

    return this.transformCollection(response.custom_collection);
  }

  /**
   * Delete a custom collection
   */
  async deleteCustom(id: number): Promise<void> {
    await this.client.request<void>(`/custom_collections/${id}.json`, { method: 'DELETE' });
  }

  // ============================================
  // Smart Collections
  // ============================================

  /**
   * List smart collections
   */
  async listSmart(options: ListCollectionsOptions = {}): Promise<Collection[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 50,
    };

    if (options.sinceId) params.since_id = options.sinceId;
    if (options.productId) params.product_id = options.productId;
    if (options.handle) params.handle = options.handle;
    if (options.updatedAtMin) params.updated_at_min = options.updatedAtMin;
    if (options.updatedAtMax) params.updated_at_max = options.updatedAtMax;
    if (options.publishedAtMin) params.published_at_min = options.publishedAtMin;
    if (options.publishedAtMax) params.published_at_max = options.publishedAtMax;
    if (options.publishedStatus) params.published_status = options.publishedStatus;
    if (options.fields) params.fields = options.fields;
    if (options.ids) params.ids = options.ids;

    const response = await this.client.request<{ smart_collections: Record<string, unknown>[] }>(
      '/smart_collections.json',
      { params }
    );

    return this.transformCollections(response.smart_collections, true);
  }

  /**
   * Get a smart collection by ID
   */
  async getSmart(id: number, fields?: string): Promise<Collection> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params.fields = fields;

    const response = await this.client.request<{ smart_collection: Record<string, unknown> }>(
      `/smart_collections/${id}.json`,
      { params }
    );

    return this.transformCollection(response.smart_collection, true);
  }

  /**
   * Get smart collection count
   */
  async countSmart(productId?: number): Promise<number> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (productId) params.product_id = productId;

    const response = await this.client.request<{ count: number }>(
      '/smart_collections/count.json',
      { params }
    );

    return response.count;
  }

  /**
   * Delete a smart collection
   */
  async deleteSmart(id: number): Promise<void> {
    await this.client.request<void>(`/smart_collections/${id}.json`, { method: 'DELETE' });
  }

  // ============================================
  // Collection Products (Collects)
  // ============================================

  /**
   * Add a product to a custom collection
   */
  async addProduct(collectionId: number, productId: number): Promise<{ id: number; collectionId: number; productId: number }> {
    const body = {
      collect: {
        collection_id: collectionId,
        product_id: productId,
      },
    };

    const response = await this.client.request<{ collect: Record<string, unknown> }>(
      '/collects.json',
      { method: 'POST', body }
    );

    return {
      id: response.collect.id as number,
      collectionId: response.collect.collection_id as number,
      productId: response.collect.product_id as number,
    };
  }

  /**
   * Remove a product from a custom collection
   */
  async removeProduct(collectId: number): Promise<void> {
    await this.client.request<void>(`/collects/${collectId}.json`, { method: 'DELETE' });
  }

  /**
   * List products in a collection
   */
  async listProducts(collectionId: number, limit?: number): Promise<{ id: number; collectionId: number; productId: number; position: number }[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      collection_id: collectionId,
      limit: limit || 50,
    };

    const response = await this.client.request<{ collects: Record<string, unknown>[] }>(
      '/collects.json',
      { params }
    );

    return response.collects.map(c => ({
      id: c.id as number,
      collectionId: c.collection_id as number,
      productId: c.product_id as number,
      position: c.position as number,
    }));
  }

  /**
   * Transform API response to our types
   */
  private transformCollection(collection: Record<string, unknown>, isSmart = false): Collection {
    const result: Collection = {
      id: collection.id as number,
      handle: collection.handle as string,
      title: collection.title as string,
      updatedAt: collection.updated_at as string,
      bodyHtml: collection.body_html as string | undefined,
      publishedAt: collection.published_at as string | undefined,
      sortOrder: collection.sort_order as string,
      templateSuffix: collection.template_suffix as string | undefined,
      productsCount: collection.products_count as number | undefined,
      publishedScope: collection.published_scope as string,
      adminGraphqlApiId: collection.admin_graphql_api_id as string,
    };

    if (isSmart) {
      result.disjunctive = collection.disjunctive as boolean | undefined;
      result.rules = (collection.rules as Record<string, unknown>[] || []).map(r => this.transformRule(r));
    }

    if (collection.image) {
      result.image = this.transformImage(collection.image as Record<string, unknown>);
    }

    return result;
  }

  private transformCollections(collections: Record<string, unknown>[], isSmart = false): Collection[] {
    return collections.map(c => this.transformCollection(c, isSmart));
  }

  private transformRule(rule: Record<string, unknown>): CollectionRule {
    return {
      column: rule.column as string,
      relation: rule.relation as string,
      condition: rule.condition as string,
    };
  }

  private transformImage(image: Record<string, unknown>): CollectionImage {
    return {
      createdAt: image.created_at as string,
      alt: image.alt as string | undefined,
      width: image.width as number,
      height: image.height as number,
      src: image.src as string,
    };
  }
}

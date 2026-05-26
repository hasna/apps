import type { WebflowClient } from './client';
import type { CollectionItem, CreateItemInput, UpdateItemInput, PaginatedResponse } from '../types';

export interface ListItemsOptions {
  offset?: number;
  limit?: number;
  cmsLocaleId?: string;
  name?: string;
  slug?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Webflow CMS Items API
 */
export class ItemsApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all items in a collection
   */
  async list(collectionId: string, options: ListItemsOptions = {}): Promise<PaginatedResponse<CollectionItem>> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    if (options.cmsLocaleId) params.cmsLocaleId = options.cmsLocaleId;
    if (options.name) params.name = options.name;
    if (options.slug) params.slug = options.slug;
    if (options.sortBy) params.sortBy = options.sortBy;
    if (options.sortOrder) params.sortOrder = options.sortOrder;

    return this.client.request<PaginatedResponse<CollectionItem>>(
      `/collections/${collectionId}/items`,
      { params }
    );
  }

  /**
   * Get a single item by ID
   */
  async get(collectionId: string, itemId: string, cmsLocaleId?: string): Promise<CollectionItem> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (cmsLocaleId) params.cmsLocaleId = cmsLocaleId;

    return this.client.request<CollectionItem>(
      `/collections/${collectionId}/items/${itemId}`,
      { params }
    );
  }

  /**
   * Create a new item in a collection
   */
  async create(collectionId: string, item: CreateItemInput, live?: boolean): Promise<CollectionItem> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (live) params.live = live;

    return this.client.request<CollectionItem>(
      `/collections/${collectionId}/items`,
      { method: 'POST', body: item, params }
    );
  }

  /**
   * Update an existing item
   */
  async update(collectionId: string, itemId: string, item: UpdateItemInput, live?: boolean): Promise<CollectionItem> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (live) params.live = live;

    return this.client.request<CollectionItem>(
      `/collections/${collectionId}/items/${itemId}`,
      { method: 'PATCH', body: item, params }
    );
  }

  /**
   * Delete an item
   */
  async delete(collectionId: string, itemId: string, live?: boolean): Promise<void> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (live) params.live = live;

    await this.client.request<void>(
      `/collections/${collectionId}/items/${itemId}`,
      { method: 'DELETE', params }
    );
  }

  /**
   * Publish items to a live collection
   */
  async publish(collectionId: string, itemIds: string[]): Promise<{ publishedItemIds: string[] }> {
    return this.client.request<{ publishedItemIds: string[] }>(
      `/collections/${collectionId}/items/publish`,
      { method: 'POST', body: { itemIds } }
    );
  }

  /**
   * Create multiple items at once (bulk)
   */
  async createBulk(collectionId: string, items: CreateItemInput[], live?: boolean): Promise<{ items: CollectionItem[] }> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (live) params.live = live;

    return this.client.request<{ items: CollectionItem[] }>(
      `/collections/${collectionId}/items/bulk`,
      { method: 'POST', body: { items }, params }
    );
  }

  /**
   * Update multiple items at once (bulk)
   */
  async updateBulk(collectionId: string, items: Array<{ id: string } & UpdateItemInput>, live?: boolean): Promise<{ items: CollectionItem[] }> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (live) params.live = live;

    return this.client.request<{ items: CollectionItem[] }>(
      `/collections/${collectionId}/items/bulk`,
      { method: 'PATCH', body: { items }, params }
    );
  }

  /**
   * Delete multiple items at once (bulk)
   */
  async deleteBulk(collectionId: string, itemIds: string[], live?: boolean): Promise<{ deletedItemIds: string[] }> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (live) params.live = live;

    return this.client.request<{ deletedItemIds: string[] }>(
      `/collections/${collectionId}/items`,
      { method: 'DELETE', body: { itemIds }, params }
    );
  }
}

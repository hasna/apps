import type { WebflowClient } from './client';
import type { Product, Sku, CreateProductInput, UpdateProductInput, PaginatedResponse } from '../types';

export interface ListProductsOptions {
  offset?: number;
  limit?: number;
  cmsLocaleId?: string;
}

export interface ListSkusOptions {
  offset?: number;
  limit?: number;
  cmsLocaleId?: string;
}

/**
 * Webflow Ecommerce Products API
 */
export class ProductsApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all products for a site
   */
  async list(siteId: string, options: ListProductsOptions = {}): Promise<PaginatedResponse<Product>> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    if (options.cmsLocaleId) params.cmsLocaleId = options.cmsLocaleId;

    return this.client.request<PaginatedResponse<Product>>(
      `/sites/${siteId}/products`,
      { params }
    );
  }

  /**
   * Get a single product by ID
   */
  async get(siteId: string, productId: string, cmsLocaleId?: string): Promise<Product> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (cmsLocaleId) params.cmsLocaleId = cmsLocaleId;

    return this.client.request<Product>(
      `/sites/${siteId}/products/${productId}`,
      { params }
    );
  }

  /**
   * Create a new product
   */
  async create(siteId: string, product: CreateProductInput): Promise<Product> {
    return this.client.request<Product>(
      `/sites/${siteId}/products`,
      { method: 'POST', body: product }
    );
  }

  /**
   * Update a product
   */
  async update(siteId: string, productId: string, product: UpdateProductInput): Promise<Product> {
    return this.client.request<Product>(
      `/sites/${siteId}/products/${productId}`,
      { method: 'PATCH', body: product }
    );
  }

  /**
   * Delete a product
   * Note: This actually sets isArchived to true, products cannot be fully deleted via API
   */
  async delete(siteId: string, productId: string): Promise<void> {
    await this.client.request<void>(
      `/sites/${siteId}/products/${productId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * List SKUs for a product
   */
  async listSkus(siteId: string, productId: string, options: ListSkusOptions = {}): Promise<{ skus: Sku[]; pagination: { offset: number; limit: number; total: number } }> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    if (options.cmsLocaleId) params.cmsLocaleId = options.cmsLocaleId;

    return this.client.request<{ skus: Sku[]; pagination: { offset: number; limit: number; total: number } }>(
      `/sites/${siteId}/products/${productId}/skus`,
      { params }
    );
  }

  /**
   * Get a single SKU
   */
  async getSku(siteId: string, productId: string, skuId: string, cmsLocaleId?: string): Promise<Sku> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (cmsLocaleId) params.cmsLocaleId = cmsLocaleId;

    return this.client.request<Sku>(
      `/sites/${siteId}/products/${productId}/skus/${skuId}`,
      { params }
    );
  }

  /**
   * Create a SKU for a product
   */
  async createSku(siteId: string, productId: string, sku: {
    fieldData: {
      name: string;
      slug: string;
      price: { value: number; unit: string };
      'compare-at-price'?: { value: number; unit: string };
      'sku-values'?: Record<string, string>;
      quantity?: number;
      'main-image'?: string;
      'more-images'?: string[];
    };
  }): Promise<Sku> {
    return this.client.request<Sku>(
      `/sites/${siteId}/products/${productId}/skus`,
      { method: 'POST', body: { skus: [sku] } }
    );
  }

  /**
   * Update a SKU
   */
  async updateSku(siteId: string, productId: string, skuId: string, updates: {
    fieldData?: Record<string, unknown>;
  }): Promise<Sku> {
    return this.client.request<Sku>(
      `/sites/${siteId}/products/${productId}/skus/${skuId}`,
      { method: 'PATCH', body: updates }
    );
  }

  /**
   * Update SKU inventory
   */
  async updateInventory(siteId: string, collectionId: string, items: Array<{
    id: string;
    fieldData: {
      quantity: number;
    };
  }>): Promise<{ items: unknown[] }> {
    return this.client.request<{ items: unknown[] }>(
      `/sites/${siteId}/inventory/${collectionId}`,
      { method: 'PATCH', body: { items } }
    );
  }
}

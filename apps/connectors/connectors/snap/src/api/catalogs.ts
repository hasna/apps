import type { SnapClient } from './client';
import type {
  Catalog,
  CatalogCreateParams,
  CatalogUpdateParams,
  CatalogResponse,
  ProductFeed,
  ProductFeedCreateParams,
  ProductFeedResponse,
  ProductItem,
  ProductItemResponse,
  ProductSet,
  ProductSetResponse,
} from '../types';

/**
 * Snapchat Catalogs API
 * Manage product catalogs for dynamic ads
 */
export class CatalogsApi {
  constructor(private readonly client: SnapClient) {}

  // ============================================
  // Catalog Operations
  // ============================================

  /**
   * List all catalogs for an organization
   */
  async list(organizationId: string): Promise<Catalog[]> {
    const response = await this.client.get<CatalogResponse>(
      `/organizations/${organizationId}/catalogs`
    );
    return response.catalogs?.map(c => c.catalog) || [];
  }

  /**
   * List all catalogs for an ad account
   */
  async listByAdAccount(adAccountId: string): Promise<Catalog[]> {
    const response = await this.client.get<CatalogResponse>(
      `/adaccounts/${adAccountId}/catalogs`
    );
    return response.catalogs?.map(c => c.catalog) || [];
  }

  /**
   * Get a specific catalog by ID
   */
  async get(catalogId: string): Promise<Catalog> {
    const response = await this.client.get<CatalogResponse>(`/catalogs/${catalogId}`);
    const catalog = response.catalogs?.[0]?.catalog;
    if (!catalog) {
      throw new Error(`Catalog ${catalogId} not found`);
    }
    return catalog;
  }

  /**
   * Create a new catalog
   */
  async create(params: CatalogCreateParams): Promise<Catalog> {
    const response = await this.client.post<CatalogResponse>(
      `/adaccounts/${params.ad_account_id}/catalogs`,
      {
        catalogs: [params],
      }
    );
    const catalog = response.catalogs?.[0]?.catalog;
    if (!catalog) {
      throw new Error('Failed to create catalog');
    }
    return catalog;
  }

  /**
   * Update a catalog
   */
  async update(catalogId: string, params: CatalogUpdateParams): Promise<Catalog> {
    const response = await this.client.put<CatalogResponse>(
      `/catalogs/${catalogId}`,
      {
        catalogs: [{ id: catalogId, ...params }],
      }
    );
    const catalog = response.catalogs?.[0]?.catalog;
    if (!catalog) {
      throw new Error('Failed to update catalog');
    }
    return catalog;
  }

  /**
   * Delete a catalog
   */
  async delete(catalogId: string): Promise<void> {
    await this.client.delete(`/catalogs/${catalogId}`);
  }

  // ============================================
  // Product Feed Operations
  // ============================================

  /**
   * List all product feeds for a catalog
   */
  async listFeeds(catalogId: string): Promise<ProductFeed[]> {
    const response = await this.client.get<ProductFeedResponse>(
      `/catalogs/${catalogId}/product_feeds`
    );
    return response.product_feeds?.map(f => f.product_feed) || [];
  }

  /**
   * Get a specific product feed by ID
   */
  async getFeed(feedId: string): Promise<ProductFeed> {
    const response = await this.client.get<ProductFeedResponse>(`/product_feeds/${feedId}`);
    const feed = response.product_feeds?.[0]?.product_feed;
    if (!feed) {
      throw new Error(`Product feed ${feedId} not found`);
    }
    return feed;
  }

  /**
   * Create a new product feed
   */
  async createFeed(params: ProductFeedCreateParams): Promise<ProductFeed> {
    const response = await this.client.post<ProductFeedResponse>(
      `/catalogs/${params.catalog_id}/product_feeds`,
      {
        product_feeds: [params],
      }
    );
    const feed = response.product_feeds?.[0]?.product_feed;
    if (!feed) {
      throw new Error('Failed to create product feed');
    }
    return feed;
  }

  /**
   * Update a product feed
   */
  async updateFeed(
    feedId: string,
    params: Partial<ProductFeedCreateParams>
  ): Promise<ProductFeed> {
    const response = await this.client.put<ProductFeedResponse>(
      `/product_feeds/${feedId}`,
      {
        product_feeds: [{ id: feedId, ...params }],
      }
    );
    const feed = response.product_feeds?.[0]?.product_feed;
    if (!feed) {
      throw new Error('Failed to update product feed');
    }
    return feed;
  }

  /**
   * Delete a product feed
   */
  async deleteFeed(feedId: string): Promise<void> {
    await this.client.delete(`/product_feeds/${feedId}`);
  }

  /**
   * Trigger a feed fetch
   */
  async fetchFeed(feedId: string): Promise<void> {
    await this.client.post(`/product_feeds/${feedId}/fetch`, {});
  }

  // ============================================
  // Product Operations
  // ============================================

  /**
   * List all products in a catalog
   */
  async listProducts(catalogId: string, limit?: number): Promise<ProductItem[]> {
    const response = await this.client.get<ProductItemResponse>(
      `/catalogs/${catalogId}/products`,
      { limit }
    );
    return response.products?.map(p => p.product) || [];
  }

  /**
   * Get a specific product by ID
   */
  async getProduct(productId: string): Promise<ProductItem> {
    const response = await this.client.get<ProductItemResponse>(`/products/${productId}`);
    const product = response.products?.[0]?.product;
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }
    return product;
  }

  /**
   * Search products in a catalog
   */
  async searchProducts(
    catalogId: string,
    query: string,
    limit?: number
  ): Promise<ProductItem[]> {
    const response = await this.client.get<ProductItemResponse>(
      `/catalogs/${catalogId}/products/search`,
      { query, limit }
    );
    return response.products?.map(p => p.product) || [];
  }

  // ============================================
  // Product Set Operations
  // ============================================

  /**
   * List all product sets for a catalog
   */
  async listProductSets(catalogId: string): Promise<ProductSet[]> {
    const response = await this.client.get<ProductSetResponse>(
      `/catalogs/${catalogId}/product_sets`
    );
    return response.product_sets?.map(s => s.product_set) || [];
  }

  /**
   * Get a specific product set by ID
   */
  async getProductSet(productSetId: string): Promise<ProductSet> {
    const response = await this.client.get<ProductSetResponse>(
      `/product_sets/${productSetId}`
    );
    const productSet = response.product_sets?.[0]?.product_set;
    if (!productSet) {
      throw new Error(`Product set ${productSetId} not found`);
    }
    return productSet;
  }

  /**
   * Create a new product set
   */
  async createProductSet(
    catalogId: string,
    name: string,
    filter?: {
      field: string;
      operator: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'NOT_CONTAINS' | 'GREATER_THAN' | 'LESS_THAN';
      value: string;
    }[]
  ): Promise<ProductSet> {
    const response = await this.client.post<ProductSetResponse>(
      `/catalogs/${catalogId}/product_sets`,
      {
        product_sets: [{
          name,
          catalog_id: catalogId,
          filter,
        }],
      }
    );
    const productSet = response.product_sets?.[0]?.product_set;
    if (!productSet) {
      throw new Error('Failed to create product set');
    }
    return productSet;
  }

  /**
   * Update a product set
   */
  async updateProductSet(
    productSetId: string,
    params: { name?: string; filter?: ProductSet['filter'] }
  ): Promise<ProductSet> {
    const response = await this.client.put<ProductSetResponse>(
      `/product_sets/${productSetId}`,
      {
        product_sets: [{ id: productSetId, ...params }],
      }
    );
    const productSet = response.product_sets?.[0]?.product_set;
    if (!productSet) {
      throw new Error('Failed to update product set');
    }
    return productSet;
  }

  /**
   * Delete a product set
   */
  async deleteProductSet(productSetId: string): Promise<void> {
    await this.client.delete(`/product_sets/${productSetId}`);
  }

  /**
   * Get products in a product set
   */
  async getProductSetProducts(productSetId: string, limit?: number): Promise<ProductItem[]> {
    const response = await this.client.get<ProductItemResponse>(
      `/product_sets/${productSetId}/products`,
      { limit }
    );
    return response.products?.map(p => p.product) || [];
  }
}

import type { TikTokClient } from './client';
import type { Catalog, CatalogCreateParams, ProductSet, Product, PaginatedData } from '../types';

/**
 * TikTok Catalogs API
 * Manage product catalogs and feeds for shopping ads
 */
export class CatalogsApi {
  constructor(private readonly client: TikTokClient) {}

  // ============================================
  // Catalog Management
  // ============================================

  /**
   * List catalogs
   * GET /catalog/get/
   */
  async list(bcId: string, params?: {
    filtering?: {
      catalog_ids?: string[];
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<Catalog>> {
    return this.client.get<PaginatedData<Catalog>>('/catalog/get/', {
      bc_id: bcId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Get a single catalog by ID
   */
  async get(bcId: string, catalogId: string): Promise<Catalog> {
    const response = await this.list(bcId, {
      filtering: { catalog_ids: [catalogId] },
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Catalog ${catalogId} not found`);
    }
    return response.list[0];
  }

  /**
   * Create a catalog
   * POST /catalog/create/
   */
  async create(params: CatalogCreateParams): Promise<{ catalog_id: string }> {
    return this.client.post<{ catalog_id: string }>('/catalog/create/', params);
  }

  /**
   * Update a catalog
   * POST /catalog/update/
   */
  async update(params: {
    bc_id: string;
    catalog_id: string;
    catalog_name?: string;
  }): Promise<{ catalog_id: string }> {
    return this.client.post<{ catalog_id: string }>('/catalog/update/', params);
  }

  /**
   * Delete a catalog
   * POST /catalog/delete/
   */
  async delete(bcId: string, catalogId: string): Promise<{ catalog_id: string }> {
    return this.client.post<{ catalog_id: string }>('/catalog/delete/', {
      bc_id: bcId,
      catalog_id: catalogId,
    });
  }

  // ============================================
  // Product Sets
  // ============================================

  /**
   * List product sets
   * GET /catalog/product_set/get/
   */
  async listProductSets(bcId: string, catalogId: string, params?: {
    filtering?: {
      product_set_ids?: string[];
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<ProductSet>> {
    return this.client.get<PaginatedData<ProductSet>>('/catalog/product_set/get/', {
      bc_id: bcId,
      catalog_id: catalogId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Create a product set
   * POST /catalog/product_set/create/
   */
  async createProductSet(params: {
    bc_id: string;
    catalog_id: string;
    product_set_name: string;
    filter?: {
      field: string;
      operator: string;
      value: string | string[];
    }[];
  }): Promise<{ product_set_id: string }> {
    return this.client.post<{ product_set_id: string }>('/catalog/product_set/create/', params);
  }

  /**
   * Update a product set
   * POST /catalog/product_set/update/
   */
  async updateProductSet(params: {
    bc_id: string;
    catalog_id: string;
    product_set_id: string;
    product_set_name?: string;
    filter?: {
      field: string;
      operator: string;
      value: string | string[];
    }[];
  }): Promise<{ product_set_id: string }> {
    return this.client.post<{ product_set_id: string }>('/catalog/product_set/update/', params);
  }

  /**
   * Delete a product set
   * POST /catalog/product_set/delete/
   */
  async deleteProductSet(bcId: string, catalogId: string, productSetId: string): Promise<{ product_set_id: string }> {
    return this.client.post<{ product_set_id: string }>('/catalog/product_set/delete/', {
      bc_id: bcId,
      catalog_id: catalogId,
      product_set_id: productSetId,
    });
  }

  // ============================================
  // Products
  // ============================================

  /**
   * List products
   * GET /catalog/product/get/
   */
  async listProducts(bcId: string, catalogId: string, params?: {
    filtering?: {
      sku_ids?: string[];
      item_group_ids?: string[];
      availability?: string;
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<Product>> {
    return this.client.get<PaginatedData<Product>>('/catalog/product/get/', {
      bc_id: bcId,
      catalog_id: catalogId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Create/update products
   * POST /catalog/product/upload/
   */
  async uploadProducts(params: {
    bc_id: string;
    catalog_id: string;
    products: Array<{
      sku_id: string;
      title: string;
      description?: string;
      availability: string;
      price: number;
      sale_price?: number;
      currency: string;
      image_link: string;
      link: string;
      brand?: string;
      item_group_id?: string;
      additional_image_link?: string[];
    }>;
  }): Promise<{
    success_count: number;
    failed_count: number;
    failed_products?: Array<{
      sku_id: string;
      error_message: string;
    }>;
  }> {
    return this.client.post('/catalog/product/upload/', params);
  }

  /**
   * Delete products
   * POST /catalog/product/delete/
   */
  async deleteProducts(bcId: string, catalogId: string, skuIds: string[]): Promise<{
    deleted_count: number;
    failed_count: number;
  }> {
    return this.client.post('/catalog/product/delete/', {
      bc_id: bcId,
      catalog_id: catalogId,
      sku_ids: skuIds,
    });
  }

  // ============================================
  // Feeds
  // ============================================

  /**
   * List feeds
   * GET /catalog/feed/get/
   */
  async listFeeds(bcId: string, catalogId: string, params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    feed_id: string;
    feed_name: string;
    feed_type: string;
    status: string;
    product_count: number;
    last_fetch_time?: string;
    create_time: string;
  }>> {
    return this.client.get('/catalog/feed/get/', {
      bc_id: bcId,
      catalog_id: catalogId,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Create a feed
   * POST /catalog/feed/create/
   */
  async createFeed(params: {
    bc_id: string;
    catalog_id: string;
    feed_name: string;
    feed_type: 'URL' | 'FILE' | 'API';
    fetch_url?: string;
    schedule_type?: 'DAILY' | 'HOURLY' | 'WEEKLY';
    schedule_hour?: number;
    file_name?: string;
    file_url?: string;
  }): Promise<{ feed_id: string }> {
    return this.client.post<{ feed_id: string }>('/catalog/feed/create/', params);
  }

  /**
   * Update a feed
   * POST /catalog/feed/update/
   */
  async updateFeed(params: {
    bc_id: string;
    catalog_id: string;
    feed_id: string;
    feed_name?: string;
    fetch_url?: string;
    schedule_type?: 'DAILY' | 'HOURLY' | 'WEEKLY';
    schedule_hour?: number;
  }): Promise<{ feed_id: string }> {
    return this.client.post<{ feed_id: string }>('/catalog/feed/update/', params);
  }

  /**
   * Delete a feed
   * POST /catalog/feed/delete/
   */
  async deleteFeed(bcId: string, catalogId: string, feedId: string): Promise<{ feed_id: string }> {
    return this.client.post<{ feed_id: string }>('/catalog/feed/delete/', {
      bc_id: bcId,
      catalog_id: catalogId,
      feed_id: feedId,
    });
  }

  /**
   * Trigger feed fetch
   * POST /catalog/feed/fetch/
   */
  async fetchFeed(bcId: string, catalogId: string, feedId: string): Promise<{ task_id: string }> {
    return this.client.post<{ task_id: string }>('/catalog/feed/fetch/', {
      bc_id: bcId,
      catalog_id: catalogId,
      feed_id: feedId,
    });
  }

  /**
   * Get feed fetch status
   * GET /catalog/feed/fetch/status/
   */
  async getFetchStatus(bcId: string, catalogId: string, feedId: string, taskId: string): Promise<{
    task_id: string;
    status: 'QUEUING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
    products_uploaded?: number;
    products_failed?: number;
    error_message?: string;
  }> {
    return this.client.get('/catalog/feed/fetch/status/', {
      bc_id: bcId,
      catalog_id: catalogId,
      feed_id: feedId,
      task_id: taskId,
    });
  }
}

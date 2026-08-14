import type { MetaClient } from './client';
import type {
  ProductCatalog,
  ProductCatalogCreateParams,
  ProductCatalogListParams,
  ProductFeed,
  ProductFeedCreateParams,
  ProductItem,
  ProductSet,
  PaginatedResponse,
} from '../types';

const DEFAULT_CATALOG_FIELDS = [
  'id',
  'name',
  'business',
  'da_display_settings',
  'default_image_url',
  'fallback_image_url',
  'feed_count',
  'is_catalog_segment',
  'product_count',
  'vertical',
];

const DEFAULT_FEED_FIELDS = [
  'id',
  'name',
  'country',
  'created_time',
  'default_currency',
  'deletion_enabled',
  'delimiter',
  'encoding',
  'file_name',
  'latest_upload',
  'product_count',
  'schedule',
];

const DEFAULT_PRODUCT_FIELDS = [
  'id',
  'name',
  'availability',
  'brand',
  'category',
  'condition',
  'currency',
  'description',
  'image_url',
  'price',
  'retailer_id',
  'sale_price',
  'url',
  'visibility',
];

const DEFAULT_PRODUCT_SET_FIELDS = [
  'id',
  'name',
  'filter',
  'product_catalog',
  'product_count',
];

/**
 * Meta Product Catalogs API
 * Manage product catalogs and feeds for dynamic ads
 */
export class CatalogsApi {
  constructor(private readonly client: MetaClient) {}

  // ============================================
  // Product Catalogs
  // ============================================

  /**
   * List product catalogs for a business
   */
  async list(businessId: string, params?: ProductCatalogListParams): Promise<PaginatedResponse<ProductCatalog>> {
    const fields = params?.fields || DEFAULT_CATALOG_FIELDS;

    return this.client.get<PaginatedResponse<ProductCatalog>>(`/${businessId}/owned_product_catalogs`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a single product catalog by ID
   */
  async get(catalogId: string, fields?: string[]): Promise<ProductCatalog> {
    return this.client.get<ProductCatalog>(`/${catalogId}`, {
      fields: (fields || DEFAULT_CATALOG_FIELDS).join(','),
    });
  }

  /**
   * Create a new product catalog
   */
  async create(businessId: string, params: ProductCatalogCreateParams): Promise<{ id: string }> {
    return this.client.post<{ id: string }>(`/${businessId}/owned_product_catalogs`, params as unknown as Record<string, unknown>);
  }

  /**
   * Update a product catalog
   */
  async update(catalogId: string, params: {
    name?: string;
    default_image_url?: string;
    fallback_image_url?: string[];
  }): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {
      name: params.name,
      default_image_url: params.default_image_url,
    };

    if (params.fallback_image_url) {
      body.fallback_image_url = JSON.stringify(params.fallback_image_url);
    }

    return this.client.post<{ success: boolean }>(`/${catalogId}`, body);
  }

  /**
   * Delete a product catalog
   */
  async delete(catalogId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${catalogId}`);
  }

  // ============================================
  // Product Feeds
  // ============================================

  /**
   * List product feeds for a catalog
   */
  async listFeeds(catalogId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<ProductFeed>> {
    const fields = params?.fields || DEFAULT_FEED_FIELDS;

    return this.client.get<PaginatedResponse<ProductFeed>>(`/${catalogId}/product_feeds`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get a single product feed by ID
   */
  async getFeed(feedId: string, fields?: string[]): Promise<ProductFeed> {
    return this.client.get<ProductFeed>(`/${feedId}`, {
      fields: (fields || DEFAULT_FEED_FIELDS).join(','),
    });
  }

  /**
   * Create a new product feed
   */
  async createFeed(catalogId: string, params: ProductFeedCreateParams): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: params.name,
      file_name: params.file_name,
      encoding: params.encoding,
      delimiter: params.delimiter,
      quoted_fields_mode: params.quoted_fields_mode,
    };

    if (params.schedule) {
      body.schedule = JSON.stringify(params.schedule);
    }

    return this.client.post<{ id: string }>(`/${catalogId}/product_feeds`, body);
  }

  /**
   * Update a product feed
   */
  async updateFeed(feedId: string, params: {
    name?: string;
    schedule?: {
      interval?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
      hour?: number;
      day_of_week?: string;
      url?: string;
    };
  }): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {
      name: params.name,
    };

    if (params.schedule) {
      body.schedule = JSON.stringify(params.schedule);
    }

    return this.client.post<{ success: boolean }>(`/${feedId}`, body);
  }

  /**
   * Delete a product feed
   */
  async deleteFeed(feedId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${feedId}`);
  }

  /**
   * Trigger a feed upload
   */
  async uploadFeed(feedId: string, params: {
    url?: string;
    update_only?: boolean;
  }): Promise<{ id: string }> {
    return this.client.post<{ id: string }>(`/${feedId}/uploads`, params as Record<string, unknown>);
  }

  /**
   * Get feed upload status
   */
  async getFeedUploadStatus(uploadId: string): Promise<{
    id: string;
    end_time?: string;
    error_count?: number;
    error_report?: string;
    num_deleted_items?: number;
    num_detected_items?: number;
    num_invalid_items?: number;
    num_persisted_items?: number;
    start_time?: string;
    status?: string;
  }> {
    return this.client.get<{
      id: string;
      end_time?: string;
      error_count?: number;
      error_report?: string;
      num_deleted_items?: number;
      num_detected_items?: number;
      num_invalid_items?: number;
      num_persisted_items?: number;
      start_time?: string;
      status?: string;
    }>(`/${uploadId}`, {
      fields: 'id,end_time,error_count,error_report,num_deleted_items,num_detected_items,num_invalid_items,num_persisted_items,start_time,status',
    });
  }

  /**
   * List feed uploads
   */
  async listFeedUploads(feedId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    end_time?: string;
    error_count?: number;
    num_detected_items?: number;
    num_persisted_items?: number;
    start_time?: string;
    status?: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      end_time?: string;
      error_count?: number;
      num_detected_items?: number;
      num_persisted_items?: number;
      start_time?: string;
      status?: string;
    }>>(`/${feedId}/uploads`, {
      fields: 'id,end_time,error_count,num_detected_items,num_persisted_items,start_time,status',
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // Products
  // ============================================

  /**
   * List products in a catalog
   */
  async listProducts(catalogId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
    filter?: string;
  }): Promise<PaginatedResponse<ProductItem>> {
    const fields = params?.fields || DEFAULT_PRODUCT_FIELDS;

    return this.client.get<PaginatedResponse<ProductItem>>(`/${catalogId}/products`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      filter: params?.filter,
    });
  }

  /**
   * Get a single product by ID
   */
  async getProduct(productId: string, fields?: string[]): Promise<ProductItem> {
    return this.client.get<ProductItem>(`/${productId}`, {
      fields: (fields || DEFAULT_PRODUCT_FIELDS).join(','),
    });
  }

  /**
   * Create a product
   */
  async createProduct(catalogId: string, product: Partial<ProductItem> & {
    retailer_id: string;
    name: string;
    availability: string;
    price: number;
    currency: string;
    url: string;
    image_url: string;
  }): Promise<{ id: string }> {
    return this.client.post<{ id: string }>(`/${catalogId}/products`, product as Record<string, unknown>);
  }

  /**
   * Update a product
   */
  async updateProduct(productId: string, params: Partial<ProductItem>): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${productId}`, params as Record<string, unknown>);
  }

  /**
   * Delete a product
   */
  async deleteProduct(productId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${productId}`);
  }

  /**
   * Batch update products
   */
  async batchUpdateProducts(catalogId: string, requests: {
    method: 'CREATE' | 'UPDATE' | 'DELETE';
    retailer_id: string;
    data?: Partial<ProductItem>;
  }[]): Promise<{
    handles: string[];
  }> {
    return this.client.post<{ handles: string[] }>(`/${catalogId}/batch`, {
      requests: JSON.stringify(requests),
    });
  }

  // ============================================
  // Product Sets
  // ============================================

  /**
   * List product sets for a catalog
   */
  async listProductSets(catalogId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<ProductSet>> {
    const fields = params?.fields || DEFAULT_PRODUCT_SET_FIELDS;

    return this.client.get<PaginatedResponse<ProductSet>>(`/${catalogId}/product_sets`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get a single product set by ID
   */
  async getProductSet(productSetId: string, fields?: string[]): Promise<ProductSet> {
    return this.client.get<ProductSet>(`/${productSetId}`, {
      fields: (fields || DEFAULT_PRODUCT_SET_FIELDS).join(','),
    });
  }

  /**
   * Create a product set
   */
  async createProductSet(catalogId: string, params: {
    name: string;
    filter?: {
      product_type?: { eq?: string; i_contains?: string };
      price?: { gt?: number; lt?: number };
      availability?: { eq?: string };
      brand?: { eq?: string };
      category?: { i_contains?: string };
      custom_label_0?: { eq?: string };
      custom_label_1?: { eq?: string };
      custom_label_2?: { eq?: string };
      custom_label_3?: { eq?: string };
      custom_label_4?: { eq?: string };
    };
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: params.name,
    };

    if (params.filter) {
      body.filter = JSON.stringify(params.filter);
    }

    return this.client.post<{ id: string }>(`/${catalogId}/product_sets`, body);
  }

  /**
   * Update a product set
   */
  async updateProductSet(productSetId: string, params: {
    name?: string;
    filter?: Record<string, unknown>;
  }): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {
      name: params.name,
    };

    if (params.filter) {
      body.filter = JSON.stringify(params.filter);
    }

    return this.client.post<{ success: boolean }>(`/${productSetId}`, body);
  }

  /**
   * Delete a product set
   */
  async deleteProductSet(productSetId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${productSetId}`);
  }

  /**
   * Get products in a product set
   */
  async getProductSetProducts(productSetId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<ProductItem>> {
    const fields = params?.fields || DEFAULT_PRODUCT_FIELDS;

    return this.client.get<PaginatedResponse<ProductItem>>(`/${productSetId}/products`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // Catalog Helpers
  // ============================================

  /**
   * Get catalog categories
   */
  async getCategories(catalogId: string): Promise<PaginatedResponse<{
    id: string;
    name: string;
    category_id: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      category_id: string;
    }>>(`/${catalogId}/categories`, {
      fields: 'id,name,category_id',
    });
  }

  /**
   * Get catalog event stats
   */
  async getEventStats(catalogId: string, params?: {
    breakdowns?: string[];
    date_preset?: string;
  }): Promise<PaginatedResponse<{
    event: string;
    count: number;
  }>> {
    return this.client.get<PaginatedResponse<{
      event: string;
      count: number;
    }>>(`/${catalogId}/event_stats`, {
      breakdowns: params?.breakdowns?.join(','),
      date_preset: params?.date_preset,
    });
  }
}

import type { ShopifyClient } from './client';
import type { Product, CreateProductRequest, UpdateProductRequest } from '../types';

// Note: API responses use snake_case, we transform to camelCase types

export interface ListProductsOptions {
  limit?: number;
  sinceId?: number;
  createdAtMin?: string;
  createdAtMax?: string;
  updatedAtMin?: string;
  updatedAtMax?: string;
  publishedAtMin?: string;
  publishedAtMax?: string;
  status?: 'active' | 'archived' | 'draft';
  vendor?: string;
  productType?: string;
  collectionId?: number;
  handle?: string;
  ids?: string;
  fields?: string;
}

/**
 * Shopify Products API
 */
export class ProductsApi {
  constructor(private readonly client: ShopifyClient) {}

  /**
   * List products
   */
  async list(options: ListProductsOptions = {}): Promise<Product[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 50,
    };

    if (options.sinceId) params.since_id = options.sinceId;
    if (options.createdAtMin) params.created_at_min = options.createdAtMin;
    if (options.createdAtMax) params.created_at_max = options.createdAtMax;
    if (options.updatedAtMin) params.updated_at_min = options.updatedAtMin;
    if (options.updatedAtMax) params.updated_at_max = options.updatedAtMax;
    if (options.publishedAtMin) params.published_at_min = options.publishedAtMin;
    if (options.publishedAtMax) params.published_at_max = options.publishedAtMax;
    if (options.status) params.status = options.status;
    if (options.vendor) params.vendor = options.vendor;
    if (options.productType) params.product_type = options.productType;
    if (options.collectionId) params.collection_id = options.collectionId;
    if (options.handle) params.handle = options.handle;
    if (options.ids) params.ids = options.ids;
    if (options.fields) params.fields = options.fields;

    const response = await this.client.request<{ products: Record<string, unknown>[] }>(
      '/products.json',
      { params }
    );

    return this.transformProducts(response.products);
  }

  /**
   * Get a single product by ID
   */
  async get(id: number, fields?: string): Promise<Product> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params.fields = fields;

    const response = await this.client.request<{ product: Record<string, unknown> }>(
      `/products/${id}.json`,
      { params }
    );

    return this.transformProduct(response.product);
  }

  /**
   * Get product count
   */
  async count(options: Pick<ListProductsOptions, 'vendor' | 'productType' | 'collectionId' | 'status'> = {}): Promise<number> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.vendor) params.vendor = options.vendor;
    if (options.productType) params.product_type = options.productType;
    if (options.collectionId) params.collection_id = options.collectionId;
    if (options.status) params.status = options.status;

    const response = await this.client.request<{ count: number }>(
      '/products/count.json',
      { params }
    );

    return response.count;
  }

  /**
   * Create a new product
   */
  async create(product: CreateProductRequest): Promise<Product> {
    const body = {
      product: {
        title: product.title,
        body_html: product.bodyHtml,
        vendor: product.vendor,
        product_type: product.productType,
        tags: product.tags,
        status: product.status,
        variants: product.variants?.map(v => ({
          price: v.price,
          sku: v.sku,
          inventory_management: v.inventoryManagement,
          inventory_quantity: v.inventoryQuantity,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
          barcode: v.barcode,
          weight: v.weight,
          weight_unit: v.weightUnit,
        })),
        images: product.images,
      },
    };

    const response = await this.client.request<{ product: Record<string, unknown> }>(
      '/products.json',
      { method: 'POST', body }
    );

    return this.transformProduct(response.product);
  }

  /**
   * Update an existing product
   */
  async update(id: number, product: UpdateProductRequest): Promise<Product> {
    const body = {
      product: {
        id,
        title: product.title,
        body_html: product.bodyHtml,
        vendor: product.vendor,
        product_type: product.productType,
        tags: product.tags,
        status: product.status,
      },
    };

    const response = await this.client.request<{ product: Record<string, unknown> }>(
      `/products/${id}.json`,
      { method: 'PUT', body }
    );

    return this.transformProduct(response.product);
  }

  /**
   * Delete a product
   */
  async delete(id: number): Promise<void> {
    await this.client.request<void>(`/products/${id}.json`, { method: 'DELETE' });
  }

  /**
   * Transform API response to our types (snake_case to camelCase)
   */
  private transformProduct(product: Record<string, unknown>): Product {
    return {
      id: product.id as number,
      title: product.title as string,
      bodyHtml: product.body_html as string | undefined,
      vendor: product.vendor as string | undefined,
      productType: product.product_type as string | undefined,
      createdAt: product.created_at as string,
      handle: product.handle as string,
      updatedAt: product.updated_at as string,
      publishedAt: product.published_at as string | undefined,
      templateSuffix: product.template_suffix as string | undefined,
      publishedScope: product.published_scope as string,
      tags: product.tags as string,
      status: product.status as 'active' | 'archived' | 'draft',
      adminGraphqlApiId: product.admin_graphql_api_id as string,
      variants: this.transformVariants(product.variants as Record<string, unknown>[] || []),
      options: this.transformOptions(product.options as Record<string, unknown>[] || []),
      images: this.transformImages(product.images as Record<string, unknown>[] || []),
      image: product.image ? this.transformImage(product.image as Record<string, unknown>) : undefined,
    };
  }

  private transformProducts(products: Record<string, unknown>[]): Product[] {
    return products.map(p => this.transformProduct(p));
  }

  private transformVariants(variants: Record<string, unknown>[]): Product['variants'] {
    return variants.map(v => ({
      id: v.id as number,
      productId: v.product_id as number,
      title: v.title as string,
      price: v.price as string,
      sku: v.sku as string | undefined,
      position: v.position as number,
      inventoryPolicy: v.inventory_policy as 'deny' | 'continue',
      compareAtPrice: v.compare_at_price as string | undefined,
      fulfillmentService: v.fulfillment_service as string,
      inventoryManagement: v.inventory_management as string | undefined,
      option1: v.option1 as string | undefined,
      option2: v.option2 as string | undefined,
      option3: v.option3 as string | undefined,
      createdAt: v.created_at as string,
      updatedAt: v.updated_at as string,
      taxable: v.taxable as boolean,
      barcode: v.barcode as string | undefined,
      grams: v.grams as number,
      imageId: v.image_id as number | undefined,
      weight: v.weight as number,
      weightUnit: v.weight_unit as string,
      inventoryItemId: v.inventory_item_id as number,
      inventoryQuantity: v.inventory_quantity as number,
      oldInventoryQuantity: v.old_inventory_quantity as number,
      requiresShipping: v.requires_shipping as boolean,
      adminGraphqlApiId: v.admin_graphql_api_id as string,
    }));
  }

  private transformOptions(options: Record<string, unknown>[]): Product['options'] {
    return options.map(o => ({
      id: o.id as number,
      productId: o.product_id as number,
      name: o.name as string,
      position: o.position as number,
      values: o.values as string[],
    }));
  }

  private transformImages(images: Record<string, unknown>[]): Product['images'] {
    return images.map(i => this.transformImage(i));
  }

  private transformImage(image: Record<string, unknown>): Product['images'][0] {
    return {
      id: image.id as number,
      productId: image.product_id as number,
      position: image.position as number,
      createdAt: image.created_at as string,
      updatedAt: image.updated_at as string,
      alt: image.alt as string | undefined,
      width: image.width as number,
      height: image.height as number,
      src: image.src as string,
      variantIds: image.variant_ids as number[],
      adminGraphqlApiId: image.admin_graphql_api_id as string,
    };
  }
}

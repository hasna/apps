import type { SquarespaceClient } from './client';
import type { Product } from '../types';

export interface ListProductsOptions {
  cursor?: string;
  query?: string;
  type?: string | string[];
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface ProductsListResponse {
  products: Product[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export interface ProductsGetResponse {
  products: Product[];
}

export class ProductsApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(options: ListProductsOptions = {}): Promise<ProductsListResponse> {
    return this.client.request<ProductsListResponse>('/v2/commerce/products', {
      params: {
        cursor: options.cursor,
        query: options.query,
        type: options.type,
        modifiedAfter: options.modifiedAfter,
        modifiedBefore: options.modifiedBefore,
      },
    });
  }

  async get(productIds: string | string[]): Promise<ProductsGetResponse> {
    const ids = (Array.isArray(productIds) ? productIds : [productIds]).map(encodeURIComponent).join(',');
    return this.client.request<ProductsGetResponse>(`/v2/commerce/products/${ids}`);
  }

  async create(product: Record<string, unknown>): Promise<Product> {
    return this.client.request<Product>('/v2/commerce/products', {
      method: 'POST',
      body: product,
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<Product> {
    return this.client.request<Product>(`/v2/commerce/products/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.client.request<void>(`/v2/commerce/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async createVariant(productId: string, variant: Record<string, unknown>): Promise<unknown> {
    return this.client.request(`/v2/commerce/products/${encodeURIComponent(productId)}/variants`, {
      method: 'POST',
      body: variant,
    });
  }

  async updateVariant(productId: string, variantId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.client.request(
      `/v2/commerce/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'POST', body: data },
    );
  }

  async deleteVariant(productId: string, variantId: string): Promise<void> {
    await this.client.request<void>(
      `/v2/commerce/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'DELETE' },
    );
  }

  async associateVariantImage(productId: string, variantId: string, imageId: string | null): Promise<unknown> {
    return this.client.request(`/v2/commerce/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/image`, {
      method: 'POST',
      body: { imageId: { present: true, value: imageId } },
    });
  }
}

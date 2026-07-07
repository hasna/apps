import type { SquarespaceClient } from './client';
import type { Product } from '../types';

export interface ListProductsOptions {
  cursor?: string;
  type?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface ProductsListResponse {
  products: Product[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class ProductsApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(options: ListProductsOptions = {}): Promise<ProductsListResponse> {
    return this.client.request<ProductsListResponse>('/commerce/products', {
      params: {
        cursor: options.cursor,
        type: options.type,
        modifiedAfter: options.modifiedAfter,
        modifiedBefore: options.modifiedBefore,
      },
    });
  }

  async get(id: string): Promise<Product> {
    return this.client.request<Product>(`/commerce/products/${encodeURIComponent(id)}`);
  }

  async create(product: Record<string, unknown>): Promise<Product> {
    return this.client.request<Product>('/commerce/products', {
      method: 'POST',
      body: product,
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<Product> {
    return this.client.request<Product>(`/commerce/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.client.request<void>(`/commerce/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async createVariant(productId: string, variant: Record<string, unknown>): Promise<unknown> {
    return this.client.request(`/commerce/products/${encodeURIComponent(productId)}/variants`, {
      method: 'POST',
      body: variant,
    });
  }

  async updateVariant(productId: string, variantId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.client.request(
      `/commerce/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'PATCH', body: data },
    );
  }

  async deleteVariant(productId: string, variantId: string): Promise<void> {
    await this.client.request<void>(
      `/commerce/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'DELETE' },
    );
  }

  async assignImage(productId: string, imageId: string, ordering?: number): Promise<unknown> {
    return this.client.request(`/commerce/products/${encodeURIComponent(productId)}/image`, {
      method: 'POST',
      body: { imageId, ordering },
    });
  }
}

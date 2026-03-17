import { ClickBankClient } from './client';
import type {
  Product,
  CreateProductParams,
  ProductsListParams,
} from '../types';

interface ProductResponse {
  product?: Product | Product[];
}

interface ProductListResponse {
  products?: Product[];
  _hasMore?: boolean;
}

export class ProductsApi {
  constructor(private readonly client: ClickBankClient) {}

  /**
   * Get the XML schema for product results
   */
  async getSchema(): Promise<string> {
    return this.client.get<string>('/products/schema', undefined, 'xml');
  }

  /**
   * Get a product by SKU
   */
  async get(sku: string, site: string): Promise<Product> {
    const response = await this.client.get<ProductResponse>(`/products/${sku}`, { site });
    const data = response.product;
    if (Array.isArray(data) && data[0]) {
      return data[0];
    }
    if (data && !Array.isArray(data)) {
      return data;
    }
    throw new Error('Product not found');
  }

  /**
   * List all products for an account
   */
  async list(params: ProductsListParams): Promise<Product[]> {
    const response = await this.client.get<ProductListResponse>('/products/list', { ...params });
    const products = response.products || [];
    return Array.isArray(products) ? products : [products];
  }

  /**
   * Create a new product
   */
  async create(params: CreateProductParams): Promise<string> {
    const { sku, ...body } = params;
    const response = await this.client.put<{ sku: string }>(`/products/${sku}`, body as Record<string, unknown>);
    return response.sku || sku;
  }

  /**
   * Delete a product
   */
  async delete(sku: string, site: string): Promise<void> {
    await this.client.delete(`/products/${sku}`, { site });
  }
}

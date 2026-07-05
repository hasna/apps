import type { WhopClient } from './client';
import type { Product, ProductListParams, WhopListResponse } from '../types';

export class ProductsApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultCompanyId?: string
  ) {}

  list(params: ProductListParams = {}): Promise<WhopListResponse<Product>> {
    return this.client.get('/products', {
      company_id: params.company_id ?? this.defaultCompanyId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      visibilities: params.visibilities,
      access_pass_types: params.access_pass_types,
      direction: params.direction,
      order: params.order,
    });
  }

  get(id: string): Promise<Product> {
    return this.client.get(`/products/${encodeURIComponent(id)}`);
  }
}

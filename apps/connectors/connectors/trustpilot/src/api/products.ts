import type { TrustpilotClient } from './client';
import type { ProductReviewSummaryOptions, ProductReviewsListOptions } from '../types';

export class ProductsApi {
  constructor(private readonly client: TrustpilotClient) {}

  async listReviews(options: ProductReviewsListOptions): Promise<unknown> {
    return this.client.get(`/private/product-reviews/business-units/${encodeURIComponent(options.businessUnitId)}/reviews`, {
      perPage: options.perPage,
      page: options.page,
      sku: options.sku,
      stars: options.stars,
      orderBy: options.orderBy,
      locale: options.locale,
      productVariantId: options.productVariantId,
    });
  }

  async reply(reviewId: string, message: string): Promise<unknown> {
    return this.client.post(`/private/product-reviews/${encodeURIComponent(reviewId)}/reply`, { message });
  }

  async getSummary(options: ProductReviewSummaryOptions): Promise<unknown> {
    return this.client.get(`/product-reviews/business-units/${encodeURIComponent(options.businessUnitId)}/summaries`, {
      sku: options.sku,
      locale: options.locale,
    }, 'apikey');
  }
}

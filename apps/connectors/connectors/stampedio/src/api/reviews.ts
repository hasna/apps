import type { StampedioClient } from './client';
import type { ReviewList, ReviewListOptions, PublicReviewOptions, StampedioReview } from '../types';

/**
 * Reviews API — read product reviews from the merchant dashboard (private) and
 * from the public storefront widget endpoint.
 */
export class ReviewsApi {
  constructor(private readonly client: StampedioClient) {}

  /**
   * List reviews from the merchant dashboard.
   * GET /v2/{storeHash}/dashboard/reviews
   */
  async list(options: ReviewListOptions = {}): Promise<ReviewList> {
    return this.client.request<ReviewList>(this.client.storePath('/dashboard/reviews'), {
      params: {
        page: options.page,
        take: options.take,
        productId: options.productId,
        minRating: options.minRating,
        type: options.type,
        sortReviews: options.sortReviews,
        email: options.email,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
      },
    });
  }

  /**
   * Retrieve published reviews from the public storefront widget endpoint.
   * GET /widget/reviews (authenticated with the public key + storeUrl query params)
   */
  async listPublic(options: PublicReviewOptions = {}): Promise<{ data: StampedioReview[]; total?: number }> {
    return this.client.publicRequest('/widget/reviews', {
      params: {
        productId: options.productId,
        page: options.page,
        take: options.take,
        minRating: options.minRating,
        sortReviews: options.sortReviews,
      },
    });
  }
}

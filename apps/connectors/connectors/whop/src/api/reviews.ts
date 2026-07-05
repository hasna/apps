import type { WhopClient } from './client';
import type { Review, ReviewListParams, WhopListResponse } from '../types';

export class ReviewsApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultCompanyId?: string
  ) {}

  list(params: ReviewListParams = {}): Promise<WhopListResponse<Review>> {
    return this.client.get('/reviews', {
      company_id: params.company_id ?? this.defaultCompanyId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      product_id: params.product_id,
      ratings: params.ratings?.map(String),
      created_before: params.created_before,
      created_after: params.created_after,
    });
  }

  get(id: string): Promise<Review> {
    return this.client.get(`/reviews/${encodeURIComponent(id)}`);
  }
}

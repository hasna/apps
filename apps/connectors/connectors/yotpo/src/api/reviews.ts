import type {
  ListReviewsParams,
  ListReviewsResponse,
  GetReviewResponse,
  CreateReviewParams,
  CreateReviewResponse,
} from '../types';
import { YotpoClient } from './client';

export class ReviewsApi {
  constructor(private readonly client: YotpoClient) {}

  async list(params: ListReviewsParams = {}): Promise<ListReviewsResponse> {
    const storeId = this.client.getStoreId();
    const query: Record<string, string | number | boolean | undefined> = {};

    if (params.since_id !== undefined) query.since_id = params.since_id;
    if (params.since_date !== undefined) query.since_date = params.since_date;
    if (params.since_updated_at !== undefined) query.since_updated_at = params.since_updated_at;
    if (params.count !== undefined) query.count = params.count;
    if (params.page !== undefined) query.page = params.page;
    if (params.deleted !== undefined) query.deleted = params.deleted;
    if (params.user_reference !== undefined) query.user_reference = params.user_reference;
    if (params.id !== undefined) query.id = params.id;

    return this.client.get<ListReviewsResponse>(
      `/v1/apps/${storeId}/reviews`,
      query,
    );
  }

  async get(reviewId: string | number): Promise<GetReviewResponse> {
    const storeId = this.client.getStoreId();
    return this.client.get<GetReviewResponse>(
      `/v1/apps/${storeId}/reviews/${reviewId}`,
    );
  }

  async create(params: CreateReviewParams): Promise<CreateReviewResponse> {
    const storeId = this.client.getStoreId();
    const token = await this.client.getUtoken();

    const body: Record<string, unknown> = {
      appkey: storeId,
      utoken: token,
      sku: params.sku,
      product_title: params.product_title,
      product_url: params.product_url,
      display_name: params.display_name,
      email: params.email,
      review_content: params.review_content,
      review_title: params.review_title,
      review_score: params.review_score,
    };

    if (params.domain !== undefined) body.domain = params.domain;
    if (params.product_description !== undefined) body.product_description = params.product_description;
    if (params.product_image_url !== undefined) body.product_image_url = params.product_image_url;
    if (params.is_incentivized !== undefined) body.is_incentivized = params.is_incentivized;
    if (params.incentive_type !== undefined) body.incentive_type = params.incentive_type;
    if (params.delivery_type !== undefined) body.delivery_type = params.delivery_type;
    if (params.order_metadata !== undefined) body.order_metadata = params.order_metadata;
    if (params.product_metadata !== undefined) body.product_metadata = params.product_metadata;
    if (params.customer_metadata !== undefined) body.customer_metadata = params.customer_metadata;
    if (params.custom_fields !== undefined) body.custom_fields = params.custom_fields;
    if (params.user_reference !== undefined) body.user_reference = params.user_reference;

    return this.client.post<CreateReviewResponse>('/reviews/dynamic_create', body, {}, false);
  }
}

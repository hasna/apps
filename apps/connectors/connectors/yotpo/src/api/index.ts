import type {
  YotpoConfig,
  ListReviewsParams,
  ListReviewsResponse,
  GetReviewResponse,
  CreateReviewParams,
  CreateReviewResponse,
} from '../types';
import { YotpoClient } from './client';
import { ReviewsApi } from './reviews';

/**
 * Yotpo API client for reviews and UGC.
 */
export class Yotpo {
  private readonly client: YotpoClient;
  public readonly reviews: ReviewsApi;

  constructor(config: YotpoConfig) {
    this.client = new YotpoClient(config);
    this.reviews = new ReviewsApi(this.client);
  }

  static fromEnv(): Yotpo {
    const storeId = process.env.YOTPO_STORE_ID;
    const apiSecret = process.env.YOTPO_API_SECRET;
    const baseUrl = process.env.YOTPO_BASE_URL;

    if (!storeId) {
      throw new Error('YOTPO_STORE_ID environment variable is required');
    }
    if (!apiSecret) {
      throw new Error('YOTPO_API_SECRET environment variable is required');
    }

    return new Yotpo({ storeId, apiSecret, baseUrl });
  }

  async listReviews(params?: ListReviewsParams): Promise<ListReviewsResponse> {
    return this.reviews.list(params);
  }

  async getReview(reviewId: string | number): Promise<GetReviewResponse> {
    return this.reviews.get(reviewId);
  }

  async createReview(params: CreateReviewParams): Promise<CreateReviewResponse> {
    return this.reviews.create(params);
  }

  async rawRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
      headers?: Record<string, string>;
      auth?: boolean;
    },
  ): Promise<T> {
    return this.client.rawRequest<T>(method, path, options);
  }

  getStoreIdPreview(): string {
    return this.client.getStoreIdPreview();
  }

  getStoreId(): string {
    return this.client.getStoreId();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): YotpoClient {
    return this.client;
  }
}

export { YotpoClient } from './client';
export { ReviewsApi } from './reviews';

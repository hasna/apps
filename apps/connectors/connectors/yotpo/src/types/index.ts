// Yotpo Connector Types

export interface YotpoConfig {
  storeId: string;
  apiSecret: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface YotpoReview {
  id: number;
  score: number;
  votes_up?: number;
  votes_down?: number;
  content?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  verified_buyer?: boolean;
  sku?: string;
  product_id?: string;
  user?: {
    display_name?: string;
    email?: string;
  };
  [key: string]: unknown;
}

export interface ListReviewsResponse {
  reviews: YotpoReview[];
  pagination?: {
    page?: number;
    per_page?: number;
    total?: number;
  };
  [key: string]: unknown;
}

export interface GetReviewResponse {
  review: YotpoReview;
  [key: string]: unknown;
}

export interface CreateReviewResponse {
  code?: number;
  review?: YotpoReview;
  [key: string]: unknown;
}

export interface ListReviewsParams {
  since_id?: string;
  since_date?: string;
  since_updated_at?: string;
  count?: number | string;
  page?: number | string;
  deleted?: boolean;
  user_reference?: string;
  id?: string;
}

export interface CreateReviewParams {
  sku: string;
  product_title: string;
  product_url: string;
  display_name: string;
  email: string;
  review_content: string;
  review_title: string;
  review_score: number;
  domain?: string;
  product_description?: string;
  product_image_url?: string;
  is_incentivized?: boolean;
  incentive_type?: string;
  delivery_type?: string;
  order_metadata?: Record<string, unknown>;
  product_metadata?: Record<string, unknown>;
  customer_metadata?: Record<string, unknown>;
  custom_fields?: Record<string, unknown>;
  user_reference?: string;
}

export class YotpoApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'YotpoApiError';
    this.statusCode = statusCode;
  }
}

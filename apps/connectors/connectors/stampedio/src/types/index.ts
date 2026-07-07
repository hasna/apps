// Stamped.io Connector Types

// ============================================
// Configuration
// ============================================

export interface StampedioConfig {
  /** Public API key used by public widget endpoints */
  publicKey?: string;
  /** Private API key sent in the stamped-api-key header for private API requests */
  privateKey: string;
  /** ShopId/storeHash identifier required in private API request paths */
  storeHash: string;
  /** Storefront domain used by public widget endpoints (e.g. shop.myshopify.com) */
  storeUrl?: string;
  /** Override the API base URL (defaults to https://stamped.io/api) */
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Errors
// ============================================

export class StampedioApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'StampedioApiError';
    this.status = status;
    this.code = code;
  }
}

// ============================================
// Reviews
// ============================================

export interface StampedioReview {
  id: number;
  rating: number;
  title?: string;
  body?: string;
  author?: string;
  email?: string;
  productId?: string | number;
  productName?: string;
  productSKU?: string;
  location?: string;
  dateCreated?: string;
  isPublished?: boolean;
  reviewVotesUp?: number;
  reviewVotesDown?: number;
  [key: string]: unknown;
}

export interface ReviewListOptions {
  /** Page number (1-based) */
  page?: number;
  /** Number of reviews to return per page */
  take?: number;
  /** Filter by product identifier */
  productId?: string | number;
  /** Filter by minimum star rating (1-5) */
  minRating?: number;
  /** Filter by review type, e.g. "review" or "question" */
  type?: string;
  /** Sort order, e.g. "featured", "highest-rating", "lowest-rating", "most-recent" */
  sortReviews?: string;
  /** Filter by reviewer email */
  email?: string;
  /** ISO date lower bound (inclusive) */
  dateFrom?: string;
  /** ISO date upper bound (inclusive) */
  dateTo?: string;
}

export interface ReviewList {
  total?: number;
  page?: number;
  perPage?: number;
  data: StampedioReview[];
  [key: string]: unknown;
}

export interface PublicReviewOptions {
  productId?: string | number;
  page?: number;
  take?: number;
  minRating?: number;
  sortReviews?: string;
}

// ============================================
// Customers
// ============================================

export interface StampedioCustomer {
  customerId?: string;
  email: string;
  customCustomerId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  datePlatformUpdated?: string;
  tags?: string[];
  addresses?: StampedioCustomerAddress[];
  [key: string]: unknown;
}

export interface StampedioCustomerAddress {
  label?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
  [key: string]: unknown;
}

// ============================================
// Loyalty
// ============================================

export interface LoyaltyPointAdjustmentInput {
  /** Customer ID from Stamped's Merchant/Loyalty APIs */
  customerId: string;
  /** Points to award (positive) or deduct (negative) */
  points: number;
  /** Human-readable reason recorded against the adjustment */
  reason?: string;
}

export interface LoyaltyPointAdjustment {
  activityId?: string;
  customerId?: string;
  dateCreated?: string;
  rule?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  [key: string]: unknown;
}

export type LoyaltyTransactionInput = LoyaltyPointAdjustmentInput;
export type LoyaltyTransaction = LoyaltyPointAdjustment;

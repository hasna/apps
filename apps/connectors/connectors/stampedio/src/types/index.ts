// Stamped.io Connector Types

// ============================================
// Configuration
// ============================================

export interface StampedioConfig {
  /** Public API key - Basic Auth username, also used for public widget endpoints */
  publicKey: string;
  /** Private API key - Basic Auth password */
  privateKey: string;
  /** Store hash - required in the path of every merchant (v2) endpoint */
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
  id?: number;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  tags?: string;
  location?: string;
  [key: string]: unknown;
}

// ============================================
// Loyalty
// ============================================

export interface LoyaltyTransactionInput {
  /** Customer email the points/transaction applies to */
  email: string;
  /** Points to award (positive) or deduct (negative) */
  points: number;
  /** Human readable reason recorded against the transaction */
  reason?: string;
  /** Optional external reference id (order id, campaign id, etc.) */
  reference?: string;
}

export interface LoyaltyTransaction {
  id?: number;
  email?: string;
  points?: number;
  pointsBalance?: number;
  reason?: string;
  reference?: string;
  dateCreated?: string;
  [key: string]: unknown;
}

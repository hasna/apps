// Trustpilot Connector Types

export interface ConnectorConfig {
  apiKey?: string;
  accessToken?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export type AuthMode = 'apikey' | 'private';

export class TrustpilotApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TrustpilotApiError';
  }

  isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  isRateLimited(): boolean {
    return this.status === 429;
  }
}

// ============================================
// Categories
// ============================================

export interface CategoryListOptions {
  country?: string;
  locale?: string;
  parentId?: string;
  depth?: number;
}

export interface CategoryGetOptions {
  categoryId: string;
  country?: string;
  locale?: string;
}

export interface CategoryBusinessUnitsOptions {
  categoryId: string;
  country?: string;
  locale?: string;
  perPage?: number;
  page?: number;
}

// ============================================
// Business Units
// ============================================

export interface BusinessUnitFindOptions {
  name: string;
}

export interface BusinessUnitSearchOptions {
  query: string;
  country?: string;
  perPage?: number;
  page?: number;
}

export interface BusinessUnitReviewsOptions {
  businessUnitId: string;
  perPage?: number;
  page?: number;
  stars?: number;
  orderBy?: 'createdat.desc' | 'createdat.asc' | 'stars.desc' | 'stars.asc';
  language?: string;
  tagGroup?: string;
  tag?: string;
}

export interface BusinessUnitReviewsSummaryOptions {
  businessUnitId: string;
  locale?: string;
}

export interface BusinessUnitWebLinksOptions {
  businessUnitId: string;
  locale?: string;
}

// ============================================
// Reviews
// ============================================

export interface ReviewReplyOptions {
  reviewId: string;
  message: string;
}

export interface ReviewReportOptions {
  reviewId: string;
  reason: string;
  explanation?: string;
}

export interface PrivateBusinessUnitReviewsOptions {
  businessUnitId: string;
  perPage?: number;
  page?: number;
  stars?: number;
  startDateTime?: string;
  endDateTime?: string;
  orderBy?: string;
  responded?: boolean;
  language?: string;
}

// ============================================
// Invitations
// ============================================

export interface CreateInvitationLinkOptions {
  businessUnitId: string;
  consumer: { name?: string; email: string };
  locale?: string;
  referenceId?: string;
  productSkus?: string[];
  tags?: string[];
}

export interface SendInvitationEmailOptions {
  businessUnitId: string;
  consumerEmail: string;
  consumerName?: string;
  locale?: string;
  referenceId?: string;
  replyTo?: string;
  senderEmail?: string;
  senderName?: string;
  tags?: string[];
  templateId?: string;
  preferredSendTime?: string;
}

// ============================================
// Product Reviews
// ============================================

export interface ProductReviewsListOptions {
  businessUnitId: string;
  perPage?: number;
  page?: number;
  sku?: string;
  stars?: number;
  orderBy?: string;
  locale?: string;
  productVariantId?: string;
}

export interface ProductReviewSummaryOptions {
  businessUnitId: string;
  sku: string;
  locale?: string;
}

// ============================================
// Consumers
// ============================================

export interface ConsumerReviewsOptions {
  consumerId: string;
  perPage?: number;
  page?: number;
  orderBy?: string;
}

// ============================================
// Tags
// ============================================

export interface CreateCustomTagOptions {
  businessUnitId: string;
  tagGroup: string;
  tag: string;
  description?: string;
}

// ============================================
// OAuth
// ============================================

export interface GenerateAuthLinkOptions {
  redirectUri: string;
  state?: string;
}

export interface AuthLinkResult {
  url: string;
}

// Whop Connector Types — https://docs.whop.com/api-reference

export interface WhopConfig {
  apiKey: string;
  companyId?: string;
  baseUrl?: string;
  apiVersionDate?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface WhopPageInfo {
  end_cursor: string | null;
  start_cursor: string | null;
  has_next_page: boolean;
  has_previous_page: boolean;
}

export interface WhopListResponse<T> {
  data: T[];
  page_info: WhopPageInfo;
}

export interface WhopErrorBody {
  error?: {
    type?: string;
    message?: string;
  };
  message?: string;
}

export class WhopApiError extends Error {
  public readonly statusCode: number;
  public readonly errorType?: string;

  constructor(message: string, statusCode: number, errorType?: string) {
    super(message);
    this.name = 'WhopApiError';
    this.statusCode = statusCode;
    this.errorType = errorType;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseWhopApiError(data: unknown, statusCode: number): WhopApiError {
  const body = data as WhopErrorBody;
  const nested = body?.error;
  const message = nested?.message || body?.message || `Whop API error: ${statusCode}`;
  return new WhopApiError(message, statusCode, nested?.type);
}

export type QueryValue = string | number | boolean | undefined | null | string[];

export interface PaginationParams {
  after?: string;
  before?: string;
  first?: number;
  last?: number;
}

export interface CompanyScopedParams extends PaginationParams {
  company_id?: string;
}

export interface MembershipListParams extends CompanyScopedParams {
  product_ids?: string[];
  plan_ids?: string[];
  user_ids?: string[];
  statuses?: string[];
  direction?: 'asc' | 'desc';
  order?: string;
}

export interface PlanListParams extends PaginationParams {
  account_id?: string;
  product_ids?: string[];
  visibilities?: string[];
  plan_types?: string[];
  release_methods?: string[];
  direction?: 'asc' | 'desc';
  order?: string;
  created_before?: string;
  created_after?: string;
}

export interface ProductListParams extends CompanyScopedParams {
  visibilities?: string[];
  access_pass_types?: string[];
  direction?: 'asc' | 'desc';
  order?: string;
}

export interface PaymentListParams extends CompanyScopedParams {
  product_ids?: string[];
  plan_ids?: string[];
  statuses?: string[];
  billing_reasons?: string[];
  currencies?: string[];
  user_ids?: string[];
  created_before?: string;
  created_after?: string;
  direction?: 'asc' | 'desc';
  order?: string;
}

export interface PromoCodeListParams extends CompanyScopedParams {
  plan_ids?: string[];
  product_ids?: string[];
  statuses?: string[];
}

export interface ReviewListParams extends CompanyScopedParams {
  product_id?: string;
  ratings?: number[];
  created_before?: string;
  created_after?: string;
}

export interface AffiliateListParams extends CompanyScopedParams {
  statuses?: string[];
  search?: string;
  direction?: 'asc' | 'desc';
  order?: string;
}

export interface WebhookListParams extends CompanyScopedParams {
  resource_types?: string[];
}

export interface CreatePromoCodeParams {
  company_id?: string;
  code: string;
  promo_type: 'percentage' | 'flat_amount';
  amount_off: number;
  plan_ids?: string[];
  product_ids?: string[];
  expiration_datetime?: string;
  stock?: number;
}

export interface CreateWebhookParams {
  company_id?: string;
  url: string;
  events: string[];
  description?: string;
  enabled?: boolean;
}

export interface CreateAffiliateParams {
  company_id?: string;
  user_id: string;
  commission_percent?: number;
}

export interface RefundPaymentParams {
  amount?: number;
  reason?: string;
}

export interface CancelMembershipParams {
  cancel_immediately?: boolean;
  void_payments?: boolean;
}

export interface AddFreeDaysParams {
  days: number;
}

export interface UpdateMembershipParams {
  metadata?: Record<string, unknown>;
}

export type Membership = Record<string, unknown>;
export type Plan = Record<string, unknown>;
export type Product = Record<string, unknown>;
export type Payment = Record<string, unknown>;
export type User = Record<string, unknown>;
export type Webhook = Record<string, unknown>;
export type PromoCode = Record<string, unknown>;
export type Review = Record<string, unknown>;
export type Affiliate = Record<string, unknown>;

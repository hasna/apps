// Stripe Capital Connector Types
//
// Rebuilt from the public Stripe Capital API reference:
// https://docs.stripe.com/api/capital

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;     // Override default base URL
  accountId?: string;   // Optional connected account (Stripe-Account header)
  apiVersion?: string;  // Stripe API version
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

/** Stripe list response wrapper */
export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/** Common list options for pagination */
export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

/** Range filter for Unix-timestamp fields */
export type TimestampRange = number | { gt?: number; gte?: number; lt?: number; lte?: number };

// ============================================
// Financing Offer
// ============================================

export type FinancingOfferStatus =
  | 'undelivered'
  | 'delivered'
  | 'accepted'
  | 'expired'
  | 'canceled'
  | 'completed'
  | 'rejected'
  | 'paid_out'
  | 'replaced';

export type FinancingType = 'cash_advance' | 'flex_loan';
export type FinancingProductType = 'standard' | 'refill';

/** Terms accepted by the connected account. */
export interface FinancingOfferAcceptedTerms {
  advance_amount: number;
  currency: string;
  fee_amount: number;
  withhold_rate: number;
}

/** Terms offered to the connected account. */
export interface FinancingOfferOfferedTerms {
  advance_amount: number;
  campaign_type?: string;
  currency: string;
  fee_amount: number;
  previous_financing_fee_amount?: number;
  withhold_rate: number;
}

export interface FinancingOffer {
  id: string;
  object: 'capital.financing_offer';
  account: string;
  accepted_terms?: FinancingOfferAcceptedTerms;
  created: number;
  expires_after?: number;
  financing_type?: FinancingType;
  livemode: boolean;
  metadata?: Record<string, string>;
  offered_terms?: FinancingOfferOfferedTerms;
  product_type?: FinancingProductType;
  replacement?: string;
  replacement_for?: string;
  status: FinancingOfferStatus;
}

export interface FinancingOfferListOptions extends ListOptions {
  connected_account?: string;
  created?: TimestampRange;
  status?: FinancingOfferStatus;
}

export interface FinancingOfferMarkDeliveredParams {
  metadata?: Record<string, string>;
}

// ============================================
// Financing Summary
// ============================================

export type FinancingSummaryStatus = 'accepted' | 'delivered' | 'none';

export interface FinancingSummaryDetails {
  advance_amount: number;
  advance_paid_out_at?: number;
  currency: string;
  current_repayment_interval?: { due_at?: number; paid_amount?: number; remaining_amount?: number };
  fee_amount: number;
  paid_amount: number;
  remaining_amount: number;
  repayment_start_date?: number;
  withhold_rate: number;
}

export interface FinancingSummary {
  object: 'capital.financing_summary';
  details?: FinancingSummaryDetails;
  financing_offer?: string;
  status?: FinancingSummaryStatus;
}

// ============================================
// Errors
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

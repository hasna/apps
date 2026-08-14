// Stripe Issuing Connector Types

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
  accountId?: string;
  apiVersion?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type Metadata = Record<string, string>;

export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

export interface StripeSearchResult<T> {
  object: 'search_result';
  data: T[];
  has_more: boolean;
  next_page?: string;
  url: string;
  total_count?: number;
}

export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export type CardholderType = 'individual' | 'company';
export type CardholderStatus = 'active' | 'blocked' | 'inactive';

export interface CardholderIndividual {
  first_name: string;
  last_name: string;
  dob?: { day: number; month: number; year: number };
  verification?: Record<string, unknown>;
}

export interface CardholderCompany {
  tax_id?: string;
}

export interface CardholderBilling {
  address: Address;
}

export interface CardholderSpendingControls {
  allowed_categories?: string[];
  blocked_categories?: string[];
  spending_limits?: {
    amount: number;
    categories?: string[];
    interval: 'all_time' | 'daily' | 'monthly' | 'per_authorization' | 'weekly' | 'yearly';
  }[];
  spending_limits_currency?: string;
}

export interface Cardholder {
  id: string;
  object: 'issuing.cardholder';
  billing: CardholderBilling;
  company?: CardholderCompany;
  created: number;
  email?: string;
  individual?: CardholderIndividual;
  livemode: boolean;
  metadata: Metadata;
  name: string;
  phone_number?: string;
  requirements?: Record<string, unknown>;
  spending_controls?: CardholderSpendingControls;
  status: CardholderStatus;
  type: CardholderType;
}

export interface CardholderCreateParams {
  type: CardholderType;
  name: string;
  billing: CardholderBilling;
  email?: string;
  phone_number?: string;
  individual?: CardholderIndividual;
  company?: CardholderCompany;
  metadata?: Metadata;
  spending_controls?: CardholderSpendingControls;
  status?: CardholderStatus;
}

export interface CardholderUpdateParams {
  billing?: CardholderBilling;
  email?: string;
  phone_number?: string;
  individual?: CardholderIndividual;
  company?: CardholderCompany;
  metadata?: Metadata;
  spending_controls?: CardholderSpendingControls;
  status?: CardholderStatus;
}

export interface CardholderListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  email?: string;
  phone_number?: string;
  status?: CardholderStatus;
  type?: CardholderType;
}

export type CardStatus = 'active' | 'canceled' | 'inactive';
export type CardType = 'physical' | 'virtual';

export interface CardShipping {
  address: Address;
  name: string;
  phone_number?: string;
  require_signature?: boolean;
  service?: 'express' | 'priority' | 'standard';
  status?: string;
  type?: 'bulk' | 'individual';
}

export interface CardSpendingControls {
  allowed_categories?: string[];
  blocked_categories?: string[];
  spending_limits?: {
    amount: number;
    categories?: string[];
    interval: 'all_time' | 'daily' | 'monthly' | 'per_authorization' | 'weekly' | 'yearly';
  }[];
  spending_limits_currency?: string;
}

export interface IssuingCard {
  id: string;
  object: 'issuing.card';
  brand: string;
  cancellation_reason?: string;
  cardholder?: Cardholder | string;
  created: number;
  currency: string;
  cvc?: string;
  exp_month: number;
  exp_year: number;
  last4: string;
  livemode: boolean;
  metadata: Metadata;
  number?: string;
  replaced_by?: string;
  replacement_for?: string;
  replacement_reason?: 'damaged' | 'expired' | 'lost' | 'stolen';
  shipping?: CardShipping;
  spending_controls?: CardSpendingControls;
  status: CardStatus;
  type: CardType;
  wallets?: Record<string, unknown>;
}

export interface CardCreateParams {
  cardholder: string;
  currency: string;
  type: CardType;
  metadata?: Metadata;
  spending_controls?: CardSpendingControls;
  shipping?: CardShipping;
  status?: CardStatus;
  replacement_for?: string;
  replacement_reason?: 'damaged' | 'expired' | 'lost' | 'stolen';
}

export interface CardUpdateParams {
  metadata?: Metadata;
  spending_controls?: CardSpendingControls;
  status?: CardStatus;
  cancellation_reason?: 'lost' | 'stolen';
}

export interface CardListOptions extends ListOptions {
  cardholder?: string;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  exp_month?: number;
  exp_year?: number;
  last4?: string;
  status?: CardStatus;
  type?: CardType;
}

export type AuthorizationStatus = 'closed' | 'pending' | 'reversed';

export interface IssuingAuthorization {
  id: string;
  object: 'issuing.authorization';
  amount: number;
  amount_details?: Record<string, unknown>;
  approved: boolean;
  authorization_method: string;
  balance_transactions: unknown[];
  card: IssuingCard | string;
  cardholder?: Cardholder | string;
  created: number;
  currency: string;
  livemode: boolean;
  merchant_amount: number;
  merchant_currency: string;
  merchant_data: Record<string, unknown>;
  metadata: Metadata;
  network_data?: Record<string, unknown>;
  pending_request?: Record<string, unknown>;
  request_history: Record<string, unknown>[];
  status: AuthorizationStatus;
  transactions: unknown[];
  verification_data?: Record<string, unknown>;
  wallet?: string;
}

export interface AuthorizationUpdateParams {
  metadata?: Metadata;
}

export interface AuthorizationListOptions extends ListOptions {
  card?: string;
  cardholder?: string;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  status?: AuthorizationStatus;
}

export type TransactionType = 'capture' | 'refund';

export interface IssuingTransaction {
  id: string;
  object: 'issuing.transaction';
  amount: number;
  amount_details?: Record<string, unknown>;
  authorization?: IssuingAuthorization | string;
  balance_transaction?: string;
  card: IssuingCard | string;
  cardholder?: Cardholder | string;
  created: number;
  currency: string;
  dispute?: string;
  livemode: boolean;
  merchant_amount: number;
  merchant_currency: string;
  merchant_data: Record<string, unknown>;
  metadata: Metadata;
  type: TransactionType;
  wallet?: string;
}

export interface TransactionUpdateParams {
  metadata?: Metadata;
}

export interface TransactionListOptions extends ListOptions {
  card?: string;
  cardholder?: string;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  type?: TransactionType;
}

export interface Event {
  id: string;
  object: 'event';
  account?: string;
  api_version?: string;
  created: number;
  data: {
    object: Record<string, unknown>;
    previous_attributes?: Record<string, unknown>;
  };
  livemode: boolean;
  pending_webhooks: number;
  request?: { id?: string; idempotency_key?: string };
  type: string;
}

export interface EventListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  delivery_success?: boolean;
  type?: string;
  types?: string[];
}

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

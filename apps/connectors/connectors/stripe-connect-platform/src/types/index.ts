// Stripe Connect Platform Connector Types
// https://docs.stripe.com/connect

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
  /** Organization account ID for sk_org_* keys (Stripe-Context header) */
  accountId?: string;
  /** Connected account ID for on-behalf-of requests (Stripe-Account header) */
  connectedAccountId?: string;
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

export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface DeletedObject {
  id: string;
  object: string;
  deleted: true;
}

export type AccountType = 'standard' | 'express' | 'custom' | 'none';

export interface AccountCapabilities {
  card_payments?: 'active' | 'inactive' | 'pending';
  transfers?: 'active' | 'inactive' | 'pending';
  [key: string]: string | undefined;
}

export interface Account {
  id: string;
  object: 'account';
  business_profile?: {
    mcc?: string;
    name?: string;
    product_description?: string;
    support_email?: string;
    support_phone?: string;
    support_url?: string;
    url?: string;
  };
  business_type?: 'company' | 'government_entity' | 'individual' | 'non_profit';
  capabilities?: AccountCapabilities;
  charges_enabled: boolean;
  country: string;
  created: number;
  default_currency?: string;
  details_submitted: boolean;
  email?: string;
  livemode: boolean;
  metadata: Metadata;
  payouts_enabled: boolean;
  requirements?: {
    currently_due: string[];
    eventually_due: string[];
    past_due: string[];
    pending_verification: string[];
    disabled_reason?: string;
  };
  settings?: Record<string, unknown>;
  type: AccountType;
}

export interface AccountCreateParams {
  type: AccountType;
  country?: string;
  email?: string;
  business_type?: 'company' | 'government_entity' | 'individual' | 'non_profit';
  capabilities?: Record<string, { requested: boolean }>;
  metadata?: Metadata;
  business_profile?: Account['business_profile'];
  company?: Record<string, unknown>;
  individual?: Record<string, unknown>;
  tos_acceptance?: {
    date?: number;
    ip?: string;
    service_agreement?: 'full' | 'recipient';
  };
}

export interface AccountUpdateParams {
  business_profile?: Account['business_profile'];
  business_type?: Account['business_type'];
  capabilities?: Record<string, { requested: boolean }>;
  email?: string;
  metadata?: Metadata;
  settings?: Record<string, unknown>;
  tos_acceptance?: AccountCreateParams['tos_acceptance'];
}

export interface AccountListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
}

export interface AccountLink {
  object: 'account_link';
  created: number;
  expires_at: number;
  url: string;
}

export interface AccountLinkCreateParams {
  account: string;
  refresh_url: string;
  return_url: string;
  type: 'account_onboarding' | 'account_update';
  collect?: 'currently_due' | 'eventually_due';
}

export interface LoginLink {
  object: 'login_link';
  created: number;
  url: string;
}

export interface Transfer {
  id: string;
  object: 'transfer';
  amount: number;
  amount_reversed: number;
  balance_transaction?: string;
  created: number;
  currency: string;
  description?: string;
  destination: string;
  destination_payment?: string;
  livemode: boolean;
  metadata: Metadata;
  reversals?: StripeList<TransferReversal>;
  reversed: boolean;
  source_transaction?: string;
  source_type?: string;
  transfer_group?: string;
}

export interface TransferReversal {
  id: string;
  object: 'transfer_reversal';
  amount: number;
  balance_transaction?: string;
  created: number;
  currency: string;
  destination_payment_refund?: string;
  metadata: Metadata;
  transfer: string;
}

export interface TransferCreateParams {
  amount: number;
  currency: string;
  destination: string;
  description?: string;
  metadata?: Metadata;
  source_transaction?: string;
  source_type?: 'bank_account' | 'card' | 'fpx';
  transfer_group?: string;
}

export interface TransferListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  destination?: string;
  transfer_group?: string;
}

export interface ApplicationFee {
  id: string;
  object: 'application_fee';
  account: string;
  amount: number;
  amount_refunded: number;
  application: string;
  balance_transaction?: string;
  charge: string;
  created: number;
  currency: string;
  livemode: boolean;
  originating_transaction?: string;
  refunded: boolean;
  refunds?: StripeList<ApplicationFeeRefund>;
}

export interface ApplicationFeeRefund {
  id: string;
  object: 'fee_refund';
  amount: number;
  balance_transaction?: string;
  created: number;
  currency: string;
  fee: string;
  metadata: Metadata;
}

export interface ApplicationFeeListOptions extends ListOptions {
  charge?: string;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
  }
}

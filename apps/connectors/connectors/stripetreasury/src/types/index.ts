// Stripe Treasury Connector Types
// Modeled on the public Stripe Treasury API: https://stripe.com/docs/api/treasury

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;     // Override default base URL
  accountId?: string;   // Connected account ID (Stripe-Account header)
  apiVersion?: string;  // Stripe API version
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

/** Key-value metadata */
export type Metadata = Record<string, string>;

/** ISO 4217 currency code (lowercase), e.g. "usd" */
export type Currency = string;

/** Stripe list response wrapper */
export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/** Common list options for cursor pagination */
export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

/** A Stripe range filter as used for `created` and similar params */
export type RangeFilter = number | { gt?: number; gte?: number; lt?: number; lte?: number };

/** Status transition timestamps shared by money-movement resources */
export interface StatusTransitions {
  posted_at?: number;
  canceled_at?: number;
  failed_at?: number;
  processing_at?: number;
  returned_at?: number;
  succeeded_at?: number;
}

// ============================================
// Financial Account
// ============================================

export type FinancialAccountStatus = 'open' | 'closed';

export interface FinancialAccountBalance {
  cash: Record<string, number>;
  inbound_pending: Record<string, number>;
  outbound_pending: Record<string, number>;
}

export interface FinancialAccountFinancialAddressAba {
  account_holder_name?: string;
  account_number?: string;
  account_number_last4?: string;
  bank_name?: string;
  routing_number?: string;
}

export interface FinancialAccountFinancialAddress {
  aba?: FinancialAccountFinancialAddressAba;
  supported_networks?: string[];
  type: 'aba';
}

export interface FinancialAccountFeatureStatus {
  status: 'active' | 'pending' | 'restricted';
  status_details: { code: string; resolution?: string; restriction?: string }[];
}

export interface FinancialAccountFeatures {
  object: 'treasury.financial_account_features';
  card_issuing?: FinancialAccountFeatureStatus;
  deposit_insurance?: FinancialAccountFeatureStatus;
  financial_addresses?: { aba?: FinancialAccountFeatureStatus };
  inbound_transfers?: { ach?: FinancialAccountFeatureStatus };
  intra_stripe_flows?: FinancialAccountFeatureStatus;
  outbound_payments?: { ach?: FinancialAccountFeatureStatus; us_domestic_wire?: FinancialAccountFeatureStatus };
  outbound_transfers?: { ach?: FinancialAccountFeatureStatus; us_domestic_wire?: FinancialAccountFeatureStatus };
}

export interface FinancialAccount {
  id: string;
  object: 'treasury.financial_account';
  active_features?: string[];
  balance: FinancialAccountBalance;
  country: string;
  created: number;
  features?: FinancialAccountFeatures;
  financial_addresses: FinancialAccountFinancialAddress[];
  livemode: boolean;
  metadata?: Metadata;
  pending_features?: string[];
  platform_restrictions?: { inbound_flows?: string; outbound_flows?: string };
  restricted_features?: string[];
  status: FinancialAccountStatus;
  status_details?: { closed?: { reasons: string[] } };
  supported_currencies: string[];
}

export interface FinancialAccountFeatureParams {
  card_issuing?: { requested: boolean };
  deposit_insurance?: { requested: boolean };
  financial_addresses?: { aba?: { requested: boolean } };
  inbound_transfers?: { ach?: { requested: boolean } };
  intra_stripe_flows?: { requested: boolean };
  outbound_payments?: { ach?: { requested: boolean }; us_domestic_wire?: { requested: boolean } };
  outbound_transfers?: { ach?: { requested: boolean }; us_domestic_wire?: { requested: boolean } };
}

export interface FinancialAccountCreateParams {
  supported_currencies: string[];
  features?: FinancialAccountFeatureParams;
  metadata?: Metadata;
  nickname?: string;
  platform_restrictions?: { inbound_flows?: 'restricted' | 'unrestricted'; outbound_flows?: 'restricted' | 'unrestricted' };
}

export interface FinancialAccountUpdateParams {
  features?: FinancialAccountFeatureParams;
  metadata?: Metadata;
  nickname?: string;
  platform_restrictions?: { inbound_flows?: 'restricted' | 'unrestricted'; outbound_flows?: 'restricted' | 'unrestricted' };
}

export interface FinancialAccountListOptions extends ListOptions {
  created?: RangeFilter;
}

// ============================================
// Transaction & Transaction Entry
// ============================================

export type TransactionStatus = 'open' | 'posted' | 'void';

export interface TransactionFlowDetails {
  credit_reversal?: string;
  debit_reversal?: string;
  inbound_transfer?: string;
  issuing_authorization?: string;
  outbound_payment?: string;
  outbound_transfer?: string;
  received_credit?: string;
  received_debit?: string;
  type: string;
}

export interface Transaction {
  id: string;
  object: 'treasury.transaction';
  amount: number;
  balance_impact: { cash: number; inbound_pending: number; outbound_pending: number };
  created: number;
  currency: Currency;
  description: string;
  entries?: StripeList<TransactionEntry>;
  financial_account: string;
  flow?: string;
  flow_details?: TransactionFlowDetails;
  flow_type: string;
  livemode: boolean;
  status: TransactionStatus;
  status_transitions: { posted_at?: number; void_at?: number };
}

export interface TransactionListOptions extends ListOptions {
  financial_account: string;
  created?: RangeFilter;
  order_by?: 'created' | 'posted_at';
  status?: TransactionStatus;
  status_transitions?: { posted_at?: RangeFilter };
}

export interface TransactionEntry {
  id: string;
  object: 'treasury.transaction_entry';
  balance_impact: { cash: number; inbound_pending: number; outbound_pending: number };
  created: number;
  currency: Currency;
  effective_at: number;
  financial_account: string;
  flow?: string;
  flow_details?: TransactionFlowDetails;
  flow_type: string;
  livemode: boolean;
  transaction: string;
  type: string;
}

export interface TransactionEntryListOptions extends ListOptions {
  financial_account: string;
  created?: RangeFilter;
  effective_at?: RangeFilter;
  order_by?: 'created' | 'effective_at';
  transaction?: string;
}

// ============================================
// Shared money-movement sub-objects
// ============================================

export interface PaymentMethodBillingDetails {
  address?: {
    city?: string;
    country?: string;
    line1?: string;
    line2?: string;
    postal_code?: string;
    state?: string;
  };
  email?: string;
  name?: string;
}

export interface DestinationPaymentMethodDetails {
  billing_details: PaymentMethodBillingDetails;
  type: string;
  financial_account?: { id: string; network: string };
  us_bank_account?: {
    account_holder_type?: string;
    account_type?: string;
    bank_name?: string;
    fingerprint?: string;
    last4?: string;
    network?: string;
    routing_number?: string;
  };
}

// ============================================
// Outbound Payment
// ============================================

export type OutboundPaymentStatus = 'canceled' | 'failed' | 'posted' | 'processing' | 'returned';

export interface OutboundPayment {
  id: string;
  object: 'treasury.outbound_payment';
  amount: number;
  cancelable: boolean;
  created: number;
  currency: Currency;
  customer?: string;
  description?: string;
  destination_payment_method?: string;
  destination_payment_method_details?: DestinationPaymentMethodDetails;
  end_user_details?: { ip_address?: string; present: boolean };
  expected_arrival_date: number;
  financial_account: string;
  hosted_regulatory_receipt_url?: string;
  livemode: boolean;
  metadata?: Metadata;
  returned_details?: { code: string; transaction: string };
  statement_descriptor: string;
  status: OutboundPaymentStatus;
  status_transitions: StatusTransitions;
  transaction: string;
}

export interface OutboundPaymentDestinationParams {
  billing_details?: PaymentMethodBillingDetails;
  financial_account?: string;
  us_bank_account?: { account_holder_type?: string; account_number?: string; account_type?: string; routing_number?: string };
}

export interface OutboundPaymentCreateParams {
  amount: number;
  currency: Currency;
  financial_account: string;
  customer?: string;
  description?: string;
  destination_payment_method?: string;
  destination_payment_method_data?: OutboundPaymentDestinationParams & { type: string };
  destination_payment_method_options?: { us_bank_account?: { network?: 'ach' | 'us_domestic_wire' } };
  end_user_details?: { ip_address?: string; present: boolean };
  metadata?: Metadata;
  statement_descriptor?: string;
}

export interface OutboundPaymentListOptions extends ListOptions {
  financial_account: string;
  created?: RangeFilter;
  customer?: string;
  status?: OutboundPaymentStatus;
}

// ============================================
// Outbound Transfer
// ============================================

export type OutboundTransferStatus = 'canceled' | 'failed' | 'posted' | 'processing' | 'returned';

export interface OutboundTransfer {
  id: string;
  object: 'treasury.outbound_transfer';
  amount: number;
  cancelable: boolean;
  created: number;
  currency: Currency;
  description?: string;
  destination_payment_method?: string;
  destination_payment_method_details?: DestinationPaymentMethodDetails;
  expected_arrival_date: number;
  financial_account: string;
  hosted_regulatory_receipt_url?: string;
  livemode: boolean;
  metadata?: Metadata;
  returned_details?: { code: string; transaction: string };
  statement_descriptor: string;
  status: OutboundTransferStatus;
  status_transitions: StatusTransitions;
  transaction: string;
}

export interface OutboundTransferCreateParams {
  amount: number;
  currency: Currency;
  financial_account: string;
  destination_payment_method: string;
  description?: string;
  destination_payment_method_options?: { us_bank_account?: { network?: 'ach' | 'us_domestic_wire' } };
  metadata?: Metadata;
  statement_descriptor?: string;
}

export interface OutboundTransferListOptions extends ListOptions {
  financial_account: string;
  created?: RangeFilter;
  status?: OutboundTransferStatus;
}

// ============================================
// Inbound Transfer
// ============================================

export type InboundTransferStatus = 'canceled' | 'failed' | 'processing' | 'succeeded';

export interface InboundTransfer {
  id: string;
  object: 'treasury.inbound_transfer';
  amount: number;
  cancelable: boolean;
  created: number;
  currency: Currency;
  description?: string;
  failure_details?: { code: string };
  financial_account: string;
  hosted_regulatory_receipt_url?: string;
  linked_flows?: { received_debit?: string };
  livemode: boolean;
  metadata?: Metadata;
  origin_payment_method?: string;
  origin_payment_method_details?: DestinationPaymentMethodDetails;
  returned?: boolean;
  statement_descriptor: string;
  status: InboundTransferStatus;
  status_transitions: StatusTransitions;
  transaction: string;
}

export interface InboundTransferCreateParams {
  amount: number;
  currency: Currency;
  financial_account: string;
  origin_payment_method: string;
  description?: string;
  metadata?: Metadata;
  statement_descriptor?: string;
}

export interface InboundTransferListOptions extends ListOptions {
  financial_account: string;
  created?: RangeFilter;
  status?: InboundTransferStatus;
}

// ============================================
// Received Credit & Received Debit
// ============================================

export type ReceivedFlowStatus = 'failed' | 'succeeded';

export interface InitiatingPaymentMethodDetails {
  billing_details: PaymentMethodBillingDetails;
  type: string;
  financial_account?: { id: string; network: string };
  us_bank_account?: { bank_name?: string; last4?: string; routing_number?: string };
}

export interface ReceivedCredit {
  id: string;
  object: 'treasury.received_credit';
  amount: number;
  created: number;
  currency: Currency;
  description: string;
  failure_code?: string;
  financial_account?: string;
  hosted_regulatory_receipt_url?: string;
  initiating_payment_method_details?: InitiatingPaymentMethodDetails;
  linked_flows?: { credit_reversal?: string; issuing_authorization?: string; issuing_transaction?: string; source_flow?: string; source_flow_type?: string };
  livemode: boolean;
  network: string;
  reversal_details?: { deadline?: number; restricted_reason?: string };
  status: ReceivedFlowStatus;
  transaction?: string;
}

export interface ReceivedCreditListOptions extends ListOptions {
  financial_account: string;
  linked_flows?: { source_flow_type?: string };
  status?: ReceivedFlowStatus;
}

export interface ReceivedDebit {
  id: string;
  object: 'treasury.received_debit';
  amount: number;
  created: number;
  currency: Currency;
  description: string;
  failure_code?: string;
  financial_account?: string;
  hosted_regulatory_receipt_url?: string;
  initiating_payment_method_details?: InitiatingPaymentMethodDetails;
  linked_flows?: { debit_reversal?: string; inbound_transfer?: string; issuing_authorization?: string; issuing_transaction?: string };
  livemode: boolean;
  network: string;
  reversal_details?: { deadline?: number; restricted_reason?: string };
  status: ReceivedFlowStatus;
  transaction?: string;
}

export interface ReceivedDebitListOptions extends ListOptions {
  financial_account: string;
  status?: ReceivedFlowStatus;
}

// ============================================
// Credit Reversal & Debit Reversal
// ============================================

export type CreditReversalStatus = 'canceled' | 'posted' | 'processing';

export interface CreditReversal {
  id: string;
  object: 'treasury.credit_reversal';
  amount: number;
  created: number;
  currency: Currency;
  financial_account: string;
  hosted_regulatory_receipt_url?: string;
  livemode: boolean;
  metadata?: Metadata;
  network: string;
  received_credit: string;
  status: CreditReversalStatus;
  status_transitions: { posted_at?: number };
  transaction?: string;
}

export interface CreditReversalCreateParams {
  received_credit: string;
  metadata?: Metadata;
}

export interface CreditReversalListOptions extends ListOptions {
  financial_account: string;
  received_credit?: string;
  status?: CreditReversalStatus;
}

export type DebitReversalStatus = 'failed' | 'processing' | 'succeeded';

export interface DebitReversal {
  id: string;
  object: 'treasury.debit_reversal';
  amount: number;
  created: number;
  currency: Currency;
  financial_account: string;
  hosted_regulatory_receipt_url?: string;
  linked_flows?: { issuing_dispute?: string };
  livemode: boolean;
  metadata?: Metadata;
  network: string;
  received_debit: string;
  status: DebitReversalStatus;
  status_transitions: { completed_at?: number };
  transaction?: string;
}

export interface DebitReversalCreateParams {
  received_debit: string;
  metadata?: Metadata;
}

export interface DebitReversalListOptions extends ListOptions {
  financial_account: string;
  received_debit?: string;
  resolution?: 'lost' | 'won';
  status?: DebitReversalStatus;
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

// Stripe Tax Advanced Connector Types
// https://docs.stripe.com/tax

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

export interface TaxCalculationLineItem {
  amount: number;
  reference?: string;
  tax_code?: string;
  quantity?: number;
}

export interface TaxCalculation {
  id: string;
  object: 'tax.calculation';
  currency: string;
  customer?: string;
  customer_details?: {
    address?: Address;
    address_source?: string;
    ip_address?: string;
    tax_ids?: Array<{ type: string; value: string }>;
    taxability_override?: string;
  };
  line_items?: StripeList<TaxCalculationLineItemResult>;
  livemode: boolean;
  ship_from_details?: { address?: Address };
  shipping_cost?: { amount: number; tax_code?: string };
  tax_amount_exclusive: number;
  tax_amount_inclusive: number;
  tax_breakdown?: unknown[];
  tax_date?: number;
  expires_at?: number;
}

export interface TaxCalculationLineItemResult {
  id: string;
  object: 'tax.calculation_line_item';
  amount: number;
  amount_tax: number;
  livemode: boolean;
  quantity?: number;
  reference?: string;
  tax_code?: string;
  tax_breakdown?: unknown[];
}

export interface CreateTaxCalculationParams {
  currency: string;
  line_items: TaxCalculationLineItem[];
  customer?: string;
  customer_details?: TaxCalculation['customer_details'];
  ship_from_details?: TaxCalculation['ship_from_details'];
  shipping_cost?: TaxCalculation['shipping_cost'];
  expand?: string[];
}

export interface TaxTransaction {
  id: string;
  object: 'tax.transaction';
  currency: string;
  customer?: string;
  customer_details?: TaxCalculation['customer_details'];
  line_items?: StripeList<TaxTransactionLineItem>;
  livemode: boolean;
  metadata?: Metadata;
  reference: string;
  reversal?: string;
  ship_from_details?: TaxCalculation['ship_from_details'];
  shipping_cost?: TaxCalculation['shipping_cost'];
  tax_date?: number;
  type: 'transaction' | 'reversal';
}

export interface TaxTransactionLineItem {
  id: string;
  object: 'tax.transaction_line_item';
  amount: number;
  amount_tax: number;
  livemode: boolean;
  quantity?: number;
  reference?: string;
  tax_code?: string;
  type: 'transaction' | 'reversal';
}

export interface CreateTaxTransactionFromCalculationParams {
  calculation: string;
  reference: string;
  expand?: string[];
  metadata?: Metadata;
}

export interface CreateTaxTransactionReversalParams {
  mode: 'full' | 'partial';
  original_transaction: string;
  reference: string;
  flat_amount?: number;
  expand?: string[];
  metadata?: Metadata;
}

export interface TaxRegistration {
  id: string;
  object: 'tax.registration';
  active_from: number;
  country: string;
  country_options?: Record<string, unknown>;
  expires_at?: number;
  livemode: boolean;
  status: 'active' | 'expired' | 'scheduled' | 'all';
}

export interface CreateTaxRegistrationParams {
  country: string;
  country_options?: Record<string, unknown>;
  active_from?: number | 'now';
  expires_at?: number;
}

export interface UpdateTaxRegistrationParams {
  active_from?: number;
  expires_at?: number;
}

export interface TaxSettings {
  object: 'tax.settings';
  defaults?: {
    tax_behavior?: 'exclusive' | 'inclusive' | 'inferred_by_currency';
    tax_code?: string;
  };
  head_office?: { address?: Address };
  livemode: boolean;
  status: 'active' | 'pending';
  status_details?: {
    active?: { lost_access_to_referenced_objects?: boolean };
    pending?: { missing_fields?: string[] };
  };
}

export interface UpdateTaxSettingsParams {
  defaults?: TaxSettings['defaults'];
  head_office?: TaxSettings['head_office'];
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
  }
}

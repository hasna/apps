// PayPal Connector Types

// ============================================
// Configuration
// ============================================

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string; // sandbox or production
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Money {
  currency_code: string;
  value: string;
}

export interface LinkDescription {
  href: string;
  rel: string;
  method?: string;
}

// ============================================
// Order Types
// ============================================

export interface Order {
  id: string;
  status: OrderStatus;
  intent: 'CAPTURE' | 'AUTHORIZE';
  purchase_units: PurchaseUnit[];
  payer?: Payer;
  create_time?: string;
  update_time?: string;
  links?: LinkDescription[];
}

export type OrderStatus = 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';

export interface PurchaseUnit {
  reference_id?: string;
  description?: string;
  custom_id?: string;
  invoice_id?: string;
  soft_descriptor?: string;
  amount: AmountWithBreakdown;
  payee?: Payee;
  items?: Item[];
  shipping?: Shipping;
  payments?: PaymentCollection;
}

export interface AmountWithBreakdown {
  currency_code: string;
  value: string;
  breakdown?: AmountBreakdown;
}

export interface AmountBreakdown {
  item_total?: Money;
  shipping?: Money;
  handling?: Money;
  tax_total?: Money;
  insurance?: Money;
  shipping_discount?: Money;
  discount?: Money;
}

export interface Payee {
  email_address?: string;
  merchant_id?: string;
}

export interface Item {
  name: string;
  unit_amount: Money;
  quantity: string;
  description?: string;
  sku?: string;
  category?: 'DIGITAL_GOODS' | 'PHYSICAL_GOODS' | 'DONATION';
}

export interface Shipping {
  name?: { full_name: string };
  address?: Address;
}

export interface Address {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_1?: string;
  admin_area_2?: string;
  postal_code?: string;
  country_code: string;
}

export interface Payer {
  name?: { given_name?: string; surname?: string };
  email_address?: string;
  payer_id?: string;
  phone?: { phone_number: { national_number: string } };
  address?: Address;
}

export interface PaymentCollection {
  authorizations?: Authorization[];
  captures?: Capture[];
  refunds?: Refund[];
}

// ============================================
// Payment Types
// ============================================

export interface Authorization {
  id: string;
  status: 'CREATED' | 'CAPTURED' | 'DENIED' | 'EXPIRED' | 'PARTIALLY_CAPTURED' | 'VOIDED' | 'PENDING';
  amount: Money;
  invoice_id?: string;
  custom_id?: string;
  create_time?: string;
  update_time?: string;
  expiration_time?: string;
  links?: LinkDescription[];
}

export interface Capture {
  id: string;
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED';
  amount: Money;
  invoice_id?: string;
  custom_id?: string;
  final_capture?: boolean;
  create_time?: string;
  update_time?: string;
  links?: LinkDescription[];
}

export interface Refund {
  id: string;
  status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED';
  amount?: Money;
  invoice_id?: string;
  note_to_payer?: string;
  create_time?: string;
  update_time?: string;
  links?: LinkDescription[];
}

// ============================================
// Invoice Types
// ============================================

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  detail: InvoiceDetail;
  invoicer?: Invoicer;
  primary_recipients?: Recipient[];
  items?: InvoiceItem[];
  amount?: InvoiceAmount;
  due_amount?: Money;
  links?: LinkDescription[];
}

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'SCHEDULED' | 'PAYMENT_PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'MARKED_AS_PAID' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'MARKED_AS_REFUNDED' | 'UNPAID' | 'PAYMENT_SCHEDULED';

export interface InvoiceDetail {
  invoice_number?: string;
  reference?: string;
  invoice_date?: string;
  currency_code: string;
  note?: string;
  term?: string;
  memo?: string;
  payment_term?: PaymentTerm;
}

export interface PaymentTerm {
  term_type?: 'DUE_ON_RECEIPT' | 'DUE_ON_DATE_SPECIFIED' | 'NET_10' | 'NET_15' | 'NET_30' | 'NET_45' | 'NET_60' | 'NET_90' | 'NO_DUE_DATE';
  due_date?: string;
}

export interface Invoicer {
  name?: { given_name?: string; surname?: string; full_name?: string };
  email_address?: string;
  phones?: { phone_number: { national_number: string }; phone_type: string }[];
  website?: string;
  tax_id?: string;
  logo_url?: string;
  additional_notes?: string;
}

export interface Recipient {
  billing_info?: {
    name?: { given_name?: string; surname?: string };
    email_address?: string;
    address?: Address;
  };
  shipping_info?: {
    name?: { full_name: string };
    address?: Address;
  };
}

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: string;
  unit_amount: Money;
  tax?: Tax;
  discount?: Discount;
  unit_of_measure?: string;
}

export interface Tax {
  name: string;
  percent: string;
  amount?: Money;
}

export interface Discount {
  percent?: string;
  amount?: Money;
}

export interface InvoiceAmount {
  currency_code: string;
  value: string;
  breakdown?: {
    item_total?: Money;
    discount?: AggregatedDiscount;
    tax_total?: Money;
    shipping?: ShippingCost;
    custom?: CustomAmount;
  };
}

export interface AggregatedDiscount {
  invoice_discount?: Discount;
  item_discount?: Money;
}

export interface ShippingCost {
  amount?: Money;
  tax?: Tax;
}

export interface CustomAmount {
  label: string;
  amount?: Money;
}

export interface InvoiceListResponse {
  total_items?: number;
  total_pages?: number;
  items?: Invoice[];
  links?: LinkDescription[];
}

// ============================================
// Payout Types
// ============================================

export interface PayoutBatch {
  batch_header: PayoutBatchHeader;
  items?: PayoutItem[];
  links?: LinkDescription[];
}

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: 'DENIED' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'CANCELED';
  time_created?: string;
  time_completed?: string;
  sender_batch_header: SenderBatchHeader;
  amount?: Money;
  fees?: Money;
}

export interface SenderBatchHeader {
  sender_batch_id?: string;
  email_subject?: string;
  email_message?: string;
  recipient_type?: 'EMAIL' | 'PHONE' | 'PAYPAL_ID';
}

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNCLAIMED' | 'RETURNED' | 'ONHOLD' | 'BLOCKED' | 'REFUNDED' | 'REVERSED';
  payout_item_fee?: Money;
  payout_batch_id: string;
  payout_item: PayoutItemDetail;
  time_processed?: string;
  links?: LinkDescription[];
}

export interface PayoutItemDetail {
  recipient_type: 'EMAIL' | 'PHONE' | 'PAYPAL_ID';
  amount: Money;
  note?: string;
  receiver: string;
  sender_item_id?: string;
}

// ============================================
// Create Options
// ============================================

export interface CreateOrderOptions {
  intent: 'CAPTURE' | 'AUTHORIZE';
  purchase_units: Array<{
    amount: AmountWithBreakdown;
    reference_id?: string;
    description?: string;
    custom_id?: string;
    invoice_id?: string;
    items?: Item[];
    shipping?: Shipping;
  }>;
  payer?: Payer;
  application_context?: {
    return_url?: string;
    cancel_url?: string;
    brand_name?: string;
    landing_page?: 'LOGIN' | 'BILLING' | 'NO_PREFERENCE';
    user_action?: 'CONTINUE' | 'PAY_NOW';
  };
}

export interface CreateInvoiceOptions {
  detail: InvoiceDetail;
  invoicer?: Invoicer;
  primary_recipients?: Recipient[];
  items?: InvoiceItem[];
  configuration?: {
    partial_payment?: { allow_partial_payment?: boolean; minimum_amount_due?: Money };
    allow_tip?: boolean;
    tax_calculated_after_discount?: boolean;
    tax_inclusive?: boolean;
  };
}

export interface CreatePayoutOptions {
  sender_batch_header: SenderBatchHeader;
  items: PayoutItemDetail[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  issue: string;
  description: string;
  field?: string;
}

export class PayPalApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'PayPalApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

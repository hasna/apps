// Stripe Connector Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
  apiSecret?: string;   // Webhook signing secret
  baseUrl?: string;     // Override default base URL
  accountId?: string;   // Required for org API keys (Stripe-Context header)
  apiVersion?: string;  // Stripe API version
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

/** Key-value metadata */
export type Metadata = Record<string, string>;

/** Stripe list response wrapper */
export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/** Stripe search result wrapper */
export interface StripeSearchResult<T> {
  object: 'search_result';
  data: T[];
  has_more: boolean;
  next_page?: string;
  url: string;
  total_count?: number;
}

/** Common list options for pagination */
export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

/** Address object */
export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

/** Shipping information */
export interface Shipping {
  address: Address;
  name: string;
  phone?: string;
  carrier?: string;
  tracking_number?: string;
}

/** Deleted object response */
export interface DeletedObject {
  id: string;
  object: string;
  deleted: true;
}

// ============================================
// Product Types
// ============================================

export interface Product {
  id: string;
  object: 'product';
  active: boolean;
  created: number;
  default_price?: string | Price;
  description?: string;
  images: string[];
  livemode: boolean;
  metadata: Metadata;
  name: string;
  package_dimensions?: {
    height: number;
    length: number;
    weight: number;
    width: number;
  };
  shippable?: boolean;
  statement_descriptor?: string;
  tax_code?: string;
  unit_label?: string;
  updated: number;
  url?: string;
}

export interface ProductCreateParams {
  name: string;
  active?: boolean;
  description?: string;
  id?: string;
  images?: string[];
  metadata?: Metadata;
  package_dimensions?: {
    height: number;
    length: number;
    weight: number;
    width: number;
  };
  shippable?: boolean;
  statement_descriptor?: string;
  tax_code?: string;
  unit_label?: string;
  url?: string;
  default_price_data?: {
    currency: string;
    unit_amount?: number;
    unit_amount_decimal?: string;
    recurring?: {
      interval: 'day' | 'week' | 'month' | 'year';
      interval_count?: number;
    };
  };
}

export interface ProductUpdateParams {
  active?: boolean;
  default_price?: string;
  description?: string;
  images?: string[];
  metadata?: Metadata;
  name?: string;
  package_dimensions?: {
    height: number;
    length: number;
    weight: number;
    width: number;
  } | '';
  shippable?: boolean;
  statement_descriptor?: string;
  tax_code?: string | '';
  unit_label?: string;
  url?: string | '';
}

export interface ProductListOptions extends ListOptions {
  active?: boolean;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  ids?: string[];
  shippable?: boolean;
  url?: string;
}

// ============================================
// Price Types
// ============================================

export type PriceType = 'one_time' | 'recurring';
export type PriceBillingScheme = 'per_unit' | 'tiered';
export type PriceTiersMode = 'graduated' | 'volume';
export type RecurringInterval = 'day' | 'week' | 'month' | 'year';
export type RecurringUsageType = 'licensed' | 'metered';

export interface PriceRecurring {
  interval: RecurringInterval;
  interval_count: number;
  usage_type: RecurringUsageType;
  aggregate_usage?: 'last_during_period' | 'last_ever' | 'max' | 'sum';
  meter?: string;
}

export interface PriceTier {
  flat_amount?: number;
  flat_amount_decimal?: string;
  unit_amount?: number;
  unit_amount_decimal?: string;
  up_to: number | 'inf';
}

export interface Price {
  id: string;
  object: 'price';
  active: boolean;
  billing_scheme: PriceBillingScheme;
  created: number;
  currency: string;
  custom_unit_amount?: {
    maximum?: number;
    minimum?: number;
    preset?: number;
  };
  livemode: boolean;
  lookup_key?: string;
  metadata: Metadata;
  nickname?: string;
  product: string | Product;
  recurring?: PriceRecurring;
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified';
  tiers?: PriceTier[];
  tiers_mode?: PriceTiersMode;
  transform_quantity?: {
    divide_by: number;
    round: 'down' | 'up';
  };
  type: PriceType;
  unit_amount?: number;
  unit_amount_decimal?: string;
}

export interface PriceCreateParams {
  currency: string;
  product?: string;
  product_data?: {
    name: string;
    active?: boolean;
    metadata?: Metadata;
    statement_descriptor?: string;
    tax_code?: string;
    unit_label?: string;
  };
  active?: boolean;
  billing_scheme?: PriceBillingScheme;
  custom_unit_amount?: {
    enabled: boolean;
    maximum?: number;
    minimum?: number;
    preset?: number;
  };
  lookup_key?: string;
  metadata?: Metadata;
  nickname?: string;
  recurring?: {
    interval: RecurringInterval;
    interval_count?: number;
    usage_type?: RecurringUsageType;
    aggregate_usage?: 'last_during_period' | 'last_ever' | 'max' | 'sum';
    meter?: string;
  };
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified';
  tiers?: {
    up_to: number | 'inf';
    flat_amount?: number;
    flat_amount_decimal?: string;
    unit_amount?: number;
    unit_amount_decimal?: string;
  }[];
  tiers_mode?: PriceTiersMode;
  transfer_lookup_key?: boolean;
  transform_quantity?: {
    divide_by: number;
    round: 'down' | 'up';
  };
  unit_amount?: number;
  unit_amount_decimal?: string;
}

export interface PriceUpdateParams {
  active?: boolean;
  lookup_key?: string;
  metadata?: Metadata;
  nickname?: string;
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified';
  transfer_lookup_key?: boolean;
}

export interface PriceListOptions extends ListOptions {
  active?: boolean;
  currency?: string;
  product?: string;
  type?: PriceType;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  lookup_keys?: string[];
  recurring?: { interval?: RecurringInterval; usage_type?: RecurringUsageType };
}

// ============================================
// Customer Types
// ============================================

export interface CustomerTaxId {
  type: string;
  value: string;
}

export interface CustomerInvoiceSettings {
  custom_fields?: { name: string; value: string }[];
  default_payment_method?: string;
  footer?: string;
  rendering_options?: {
    amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax';
  };
}

export interface Customer {
  id: string;
  object: 'customer';
  address?: Address;
  balance: number;
  created: number;
  currency?: string;
  default_source?: string;
  delinquent: boolean;
  description?: string;
  discount?: Discount;
  email?: string;
  invoice_prefix?: string;
  invoice_settings: CustomerInvoiceSettings;
  livemode: boolean;
  metadata: Metadata;
  name?: string;
  next_invoice_sequence?: number;
  phone?: string;
  preferred_locales: string[];
  shipping?: Shipping;
  sources?: StripeList<PaymentSource>;
  subscriptions?: StripeList<Subscription>;
  tax?: {
    automatic_tax: 'failed' | 'not_collecting' | 'supported' | 'unrecognized_location';
    ip_address?: string;
    location?: { country: string; state?: string; source: string };
  };
  tax_exempt?: 'exempt' | 'none' | 'reverse';
  tax_ids?: StripeList<CustomerTaxId>;
  test_clock?: string;
}

export interface CustomerCreateParams {
  address?: Address;
  balance?: number;
  coupon?: string;
  description?: string;
  email?: string;
  invoice_prefix?: string;
  invoice_settings?: CustomerInvoiceSettings;
  metadata?: Metadata;
  name?: string;
  next_invoice_sequence?: number;
  payment_method?: string;
  phone?: string;
  preferred_locales?: string[];
  promotion_code?: string;
  shipping?: Shipping;
  source?: string;
  tax?: { ip_address?: string; validate_location?: 'deferred' | 'immediately' };
  tax_exempt?: 'exempt' | 'none' | 'reverse';
  tax_id_data?: { type: string; value: string }[];
  test_clock?: string;
}

export interface CustomerUpdateParams {
  address?: Address | '';
  balance?: number;
  coupon?: string | '';
  default_source?: string;
  description?: string | '';
  email?: string | '';
  invoice_prefix?: string;
  invoice_settings?: CustomerInvoiceSettings;
  metadata?: Metadata;
  name?: string | '';
  next_invoice_sequence?: number;
  phone?: string | '';
  preferred_locales?: string[];
  promotion_code?: string;
  shipping?: Shipping | '';
  source?: string;
  tax?: { ip_address?: string | ''; validate_location?: 'deferred' | 'immediately' };
  tax_exempt?: 'exempt' | 'none' | 'reverse' | '';
}

export interface CustomerListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  email?: string;
  test_clock?: string;
}

// ============================================
// Subscription Types
// ============================================

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid';

export type CollectionMethod = 'charge_automatically' | 'send_invoice';
export type ProrationBehavior = 'always_invoice' | 'create_prorations' | 'none';

export interface SubscriptionItem {
  id: string;
  object: 'subscription_item';
  billing_thresholds?: { usage_gte: number };
  created: number;
  metadata: Metadata;
  price: Price;
  quantity?: number;
  subscription: string;
  tax_rates?: TaxRate[];
}

export interface Subscription {
  id: string;
  object: 'subscription';
  application?: string;
  application_fee_percent?: number;
  automatic_tax: { enabled: boolean; liability?: { type: string; account?: string } };
  billing_cycle_anchor: number;
  billing_cycle_anchor_config?: { day_of_month: number; hour?: number; minute?: number; second?: number };
  billing_thresholds?: { amount_gte?: number; reset_billing_cycle_anchor?: boolean };
  cancel_at?: number;
  cancel_at_period_end: boolean;
  canceled_at?: number;
  cancellation_details?: { comment?: string; feedback?: string; reason?: string };
  collection_method: CollectionMethod;
  created: number;
  currency: string;
  current_period_end: number;
  current_period_start: number;
  customer: string | Customer;
  days_until_due?: number;
  default_payment_method?: string | PaymentMethod;
  default_source?: string;
  default_tax_rates?: TaxRate[];
  description?: string;
  discount?: Discount;
  discounts: (string | Discount)[];
  ended_at?: number;
  invoice_settings: { account_tax_ids?: string[]; issuer?: { type: string; account?: string } };
  items: StripeList<SubscriptionItem>;
  latest_invoice?: string | Invoice;
  livemode: boolean;
  metadata: Metadata;
  next_pending_invoice_item_invoice?: number;
  on_behalf_of?: string;
  pause_collection?: { behavior: string; resumes_at?: number };
  payment_settings?: {
    payment_method_options?: Record<string, unknown>;
    payment_method_types?: string[];
    save_default_payment_method?: string;
  };
  pending_invoice_item_interval?: { interval: RecurringInterval; interval_count: number };
  pending_setup_intent?: string;
  pending_update?: {
    billing_cycle_anchor?: number;
    expires_at: number;
    subscription_items?: SubscriptionItem[];
    trial_end?: number;
    trial_from_plan?: boolean;
  };
  schedule?: string;
  start_date: number;
  status: SubscriptionStatus;
  test_clock?: string;
  transfer_data?: { amount_percent?: number; destination: string };
  trial_end?: number;
  trial_settings?: { end_behavior: { missing_payment_method: string } };
  trial_start?: number;
}

export interface SubscriptionCreateParams {
  customer: string;
  items?: {
    price?: string;
    quantity?: number;
    metadata?: Metadata;
    tax_rates?: string[];
    billing_thresholds?: { usage_gte: number };
  }[];
  add_invoice_items?: {
    price?: string;
    price_data?: {
      currency: string;
      product: string;
      unit_amount?: number;
      unit_amount_decimal?: string;
    };
    quantity?: number;
    tax_rates?: string[];
    discounts?: { coupon?: string; discount?: string; promotion_code?: string }[];
  }[];
  application_fee_percent?: number;
  automatic_tax?: { enabled: boolean; liability?: { type: string; account?: string } };
  backdate_start_date?: number;
  billing_cycle_anchor?: number;
  billing_cycle_anchor_config?: { day_of_month: number; hour?: number; minute?: number; second?: number };
  billing_thresholds?: { amount_gte?: number; reset_billing_cycle_anchor?: boolean };
  cancel_at?: number;
  cancel_at_period_end?: boolean;
  collection_method?: CollectionMethod;
  coupon?: string;
  currency?: string;
  days_until_due?: number;
  default_payment_method?: string;
  default_source?: string;
  default_tax_rates?: string[];
  description?: string;
  discounts?: { coupon?: string; discount?: string; promotion_code?: string }[];
  invoice_settings?: { account_tax_ids?: string[]; issuer?: { type: string; account?: string } };
  metadata?: Metadata;
  off_session?: boolean;
  on_behalf_of?: string;
  payment_behavior?: 'allow_incomplete' | 'default_incomplete' | 'error_if_incomplete' | 'pending_if_incomplete';
  payment_settings?: {
    payment_method_options?: Record<string, unknown>;
    payment_method_types?: string[];
    save_default_payment_method?: 'off' | 'on_subscription';
  };
  pending_invoice_item_interval?: { interval: RecurringInterval; interval_count?: number };
  promotion_code?: string;
  proration_behavior?: ProrationBehavior;
  transfer_data?: { amount_percent?: number; destination: string };
  trial_end?: number | 'now';
  trial_from_plan?: boolean;
  trial_period_days?: number;
  trial_settings?: { end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' } };
}

export interface SubscriptionUpdateParams {
  add_invoice_items?: {
    price?: string;
    price_data?: { currency: string; product: string; unit_amount?: number; unit_amount_decimal?: string };
    quantity?: number;
    tax_rates?: string[];
    discounts?: { coupon?: string; discount?: string; promotion_code?: string }[];
  }[];
  application_fee_percent?: number;
  automatic_tax?: { enabled: boolean; liability?: { type: string; account?: string } };
  billing_cycle_anchor?: 'now' | 'unchanged';
  billing_thresholds?: { amount_gte?: number; reset_billing_cycle_anchor?: boolean } | '';
  cancel_at?: number | '';
  cancel_at_period_end?: boolean;
  cancellation_details?: { comment?: string; feedback?: string };
  collection_method?: CollectionMethod;
  coupon?: string;
  days_until_due?: number;
  default_payment_method?: string;
  default_source?: string | '';
  default_tax_rates?: string[] | '';
  description?: string | '';
  discounts?: { coupon?: string; discount?: string; promotion_code?: string }[] | '';
  invoice_settings?: { account_tax_ids?: string[] | ''; issuer?: { type: string; account?: string } };
  items?: {
    id?: string;
    price?: string;
    quantity?: number;
    metadata?: Metadata;
    tax_rates?: string[];
    billing_thresholds?: { usage_gte: number } | '';
    deleted?: boolean;
    clear_usage?: boolean;
  }[];
  metadata?: Metadata;
  off_session?: boolean;
  on_behalf_of?: string | '';
  pause_collection?: { behavior: 'keep_as_draft' | 'mark_uncollectible' | 'void'; resumes_at?: number } | '';
  payment_behavior?: 'allow_incomplete' | 'default_incomplete' | 'error_if_incomplete' | 'pending_if_incomplete';
  payment_settings?: {
    payment_method_options?: Record<string, unknown>;
    payment_method_types?: string[] | '';
    save_default_payment_method?: 'off' | 'on_subscription';
  };
  pending_invoice_item_interval?: { interval: RecurringInterval; interval_count?: number } | '';
  promotion_code?: string;
  proration_behavior?: ProrationBehavior;
  proration_date?: number;
  transfer_data?: { amount_percent?: number; destination: string } | '';
  trial_end?: number | 'now';
  trial_from_plan?: boolean;
  trial_settings?: { end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' } };
}

export interface SubscriptionCancelParams {
  cancellation_details?: { comment?: string; feedback?: string };
  invoice_now?: boolean;
  prorate?: boolean;
}

export interface SubscriptionResumeParams {
  billing_cycle_anchor?: 'now' | 'unchanged';
  proration_behavior?: ProrationBehavior;
  proration_date?: number;
}

export interface SubscriptionListOptions extends ListOptions {
  automatic_tax?: { enabled: boolean };
  collection_method?: CollectionMethod;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  current_period_end?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  current_period_start?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  customer?: string;
  price?: string;
  status?: SubscriptionStatus | 'all' | 'ended';
  test_clock?: string;
}

// ============================================
// Subscription Item Types
// ============================================

export interface SubscriptionItemCreateParams {
  subscription: string;
  price?: string;
  price_data?: {
    currency: string;
    product: string;
    recurring: { interval: RecurringInterval; interval_count?: number };
    unit_amount?: number;
    unit_amount_decimal?: string;
  };
  quantity?: number;
  billing_thresholds?: { usage_gte: number };
  metadata?: Metadata;
  payment_behavior?: 'allow_incomplete' | 'default_incomplete' | 'error_if_incomplete' | 'pending_if_incomplete';
  proration_behavior?: ProrationBehavior;
  proration_date?: number;
  tax_rates?: string[];
}

export interface SubscriptionItemUpdateParams {
  price?: string;
  price_data?: {
    currency: string;
    product: string;
    recurring: { interval: RecurringInterval; interval_count?: number };
    unit_amount?: number;
    unit_amount_decimal?: string;
  };
  quantity?: number;
  billing_thresholds?: { usage_gte: number } | '';
  metadata?: Metadata;
  off_session?: boolean;
  payment_behavior?: 'allow_incomplete' | 'default_incomplete' | 'error_if_incomplete' | 'pending_if_incomplete';
  proration_behavior?: ProrationBehavior;
  proration_date?: number;
  tax_rates?: string[];
}

export interface SubscriptionItemDeleteParams {
  clear_usage?: boolean;
  proration_behavior?: ProrationBehavior;
  proration_date?: number;
}

export interface SubscriptionItemListOptions extends ListOptions {
  subscription: string;
}

// ============================================
// Payment Intent Types
// ============================================

export type PaymentIntentStatus =
  | 'canceled'
  | 'processing'
  | 'requires_action'
  | 'requires_capture'
  | 'requires_confirmation'
  | 'requires_payment_method'
  | 'succeeded';

export type CaptureMethod = 'automatic' | 'automatic_async' | 'manual';
export type ConfirmationMethod = 'automatic' | 'manual';
export type SetupFutureUsage = 'off_session' | 'on_session';

export interface PaymentIntentNextAction {
  type: string;
  redirect_to_url?: { return_url: string; url: string };
  use_stripe_sdk?: Record<string, unknown>;
  alipay_handle_redirect?: { native_data?: string; native_url?: string; return_url?: string; url?: string };
  boleto_display_details?: { expires_at?: number; hosted_voucher_url?: string; number?: string; pdf?: string };
  card_await_notification?: { charge_attempt_at?: number; customer_approval_required?: boolean };
  display_bank_transfer_instructions?: Record<string, unknown>;
  konbini_display_details?: Record<string, unknown>;
  oxxo_display_details?: { expires_after?: number; hosted_voucher_url?: string; number?: string };
  pix_display_qr_code?: { data?: string; expires_at?: number; hosted_instructions_url?: string; image_url_png?: string; image_url_svg?: string };
  promptpay_display_qr_code?: { data?: string; hosted_instructions_url?: string; image_url_png?: string; image_url_svg?: string };
  swish_handle_redirect_or_display_qr_code?: { hosted_instructions_url?: string; mobile_auth_url?: string; qr_code?: { data?: string; image_url_png?: string; image_url_svg?: string } };
  verify_with_microdeposits?: { arrival_date?: number; hosted_verification_url?: string; microdeposit_type?: string };
  wechat_pay_display_qr_code?: { data?: string; hosted_instructions_url?: string; image_data_url?: string; image_url_png?: string; image_url_svg?: string };
  wechat_pay_redirect_to_android_app?: Record<string, unknown>;
  wechat_pay_redirect_to_ios_app?: Record<string, unknown>;
}

export interface PaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  amount_capturable: number;
  amount_details?: { tip?: { amount?: number } };
  amount_received: number;
  application?: string;
  application_fee_amount?: number;
  automatic_payment_methods?: { allow_redirects?: string; enabled: boolean };
  canceled_at?: number;
  cancellation_reason?: string;
  capture_method: CaptureMethod;
  client_secret?: string;
  confirmation_method: ConfirmationMethod;
  created: number;
  currency: string;
  customer?: string | Customer;
  description?: string;
  invoice?: string | Invoice;
  last_payment_error?: {
    charge?: string;
    code?: string;
    decline_code?: string;
    doc_url?: string;
    message?: string;
    param?: string;
    payment_method?: PaymentMethod;
    payment_method_type?: string;
    type: string;
  };
  latest_charge?: string | Charge;
  livemode: boolean;
  metadata: Metadata;
  next_action?: PaymentIntentNextAction;
  on_behalf_of?: string;
  payment_method?: string | PaymentMethod;
  payment_method_configuration_details?: { id: string; parent?: string };
  payment_method_options?: Record<string, unknown>;
  payment_method_types: string[];
  processing?: { card?: { customer_notification?: { approval_requested?: boolean; completes_at?: number } } };
  receipt_email?: string;
  review?: string;
  setup_future_usage?: SetupFutureUsage;
  shipping?: Shipping;
  source?: string;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  status: PaymentIntentStatus;
  transfer_data?: { amount?: number; destination: string };
  transfer_group?: string;
}

export interface PaymentIntentCreateParams {
  amount: number;
  currency: string;
  application_fee_amount?: number;
  automatic_payment_methods?: { allow_redirects?: 'always' | 'never'; enabled: boolean };
  capture_method?: CaptureMethod;
  confirm?: boolean;
  confirmation_method?: ConfirmationMethod;
  customer?: string;
  description?: string;
  error_on_requires_action?: boolean;
  mandate?: string;
  mandate_data?: { customer_acceptance: { type: string; accepted_at?: number; offline?: Record<string, unknown>; online?: { ip_address: string; user_agent: string } } };
  metadata?: Metadata;
  off_session?: boolean | 'one_off' | 'recurring';
  on_behalf_of?: string;
  payment_method?: string;
  payment_method_configuration?: string;
  payment_method_data?: Record<string, unknown>;
  payment_method_options?: Record<string, unknown>;
  payment_method_types?: string[];
  radar_options?: { session?: string };
  receipt_email?: string;
  return_url?: string;
  setup_future_usage?: SetupFutureUsage;
  shipping?: Shipping;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  transfer_data?: { amount?: number; destination: string };
  transfer_group?: string;
  use_stripe_sdk?: boolean;
}

export interface PaymentIntentUpdateParams {
  amount?: number;
  application_fee_amount?: number;
  capture_method?: CaptureMethod;
  currency?: string;
  customer?: string;
  description?: string | '';
  metadata?: Metadata;
  payment_method?: string;
  payment_method_configuration?: string;
  payment_method_data?: Record<string, unknown>;
  payment_method_options?: Record<string, unknown>;
  payment_method_types?: string[];
  receipt_email?: string | '';
  setup_future_usage?: SetupFutureUsage | '';
  shipping?: Shipping | '';
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  transfer_data?: { amount?: number };
  transfer_group?: string;
}

export interface PaymentIntentConfirmParams {
  capture_method?: CaptureMethod;
  error_on_requires_action?: boolean;
  mandate?: string;
  mandate_data?: { customer_acceptance: { type: string; accepted_at?: number; offline?: Record<string, unknown>; online?: { ip_address: string; user_agent: string } } };
  off_session?: boolean | 'one_off' | 'recurring';
  payment_method?: string;
  payment_method_data?: Record<string, unknown>;
  payment_method_options?: Record<string, unknown>;
  payment_method_types?: string[];
  radar_options?: { session?: string };
  receipt_email?: string | '';
  return_url?: string;
  setup_future_usage?: SetupFutureUsage | '';
  shipping?: Shipping | '';
  use_stripe_sdk?: boolean;
}

export interface PaymentIntentCancelParams {
  cancellation_reason?: 'abandoned' | 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export interface PaymentIntentCaptureParams {
  amount_to_capture?: number;
  application_fee_amount?: number;
  final_capture?: boolean;
  metadata?: Metadata;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  transfer_data?: { amount?: number };
}

export interface PaymentIntentListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  customer?: string;
}

// ============================================
// Payment Method Types
// ============================================

export type PaymentMethodType =
  | 'acss_debit'
  | 'affirm'
  | 'afterpay_clearpay'
  | 'alipay'
  | 'amazon_pay'
  | 'au_becs_debit'
  | 'bacs_debit'
  | 'bancontact'
  | 'blik'
  | 'boleto'
  | 'card'
  | 'card_present'
  | 'cashapp'
  | 'customer_balance'
  | 'eps'
  | 'fpx'
  | 'giropay'
  | 'grabpay'
  | 'ideal'
  | 'interac_present'
  | 'klarna'
  | 'konbini'
  | 'link'
  | 'mobilepay'
  | 'multibanco'
  | 'oxxo'
  | 'p24'
  | 'paynow'
  | 'paypal'
  | 'pix'
  | 'promptpay'
  | 'revolut_pay'
  | 'sepa_debit'
  | 'sofort'
  | 'swish'
  | 'twint'
  | 'us_bank_account'
  | 'wechat_pay'
  | 'zip';

export interface PaymentMethodCard {
  brand: string;
  checks?: { address_line1_check?: string; address_postal_code_check?: string; cvc_check?: string };
  country?: string;
  display_brand?: string;
  exp_month: number;
  exp_year: number;
  fingerprint?: string;
  funding: string;
  generated_from?: { charge?: string; payment_method_details?: Record<string, unknown>; setup_attempt?: string };
  last4: string;
  networks?: { available: string[]; preferred?: string };
  three_d_secure_usage?: { supported: boolean };
  wallet?: Record<string, unknown>;
}

export interface PaymentMethod {
  id: string;
  object: 'payment_method';
  billing_details: {
    address?: Address;
    email?: string;
    name?: string;
    phone?: string;
  };
  card?: PaymentMethodCard;
  created: number;
  customer?: string | Customer;
  livemode: boolean;
  metadata: Metadata;
  type: PaymentMethodType;
  acss_debit?: Record<string, unknown>;
  affirm?: Record<string, unknown>;
  afterpay_clearpay?: Record<string, unknown>;
  alipay?: Record<string, unknown>;
  amazon_pay?: Record<string, unknown>;
  au_becs_debit?: Record<string, unknown>;
  bacs_debit?: Record<string, unknown>;
  bancontact?: Record<string, unknown>;
  blik?: Record<string, unknown>;
  boleto?: Record<string, unknown>;
  cashapp?: Record<string, unknown>;
  customer_balance?: Record<string, unknown>;
  eps?: Record<string, unknown>;
  fpx?: Record<string, unknown>;
  giropay?: Record<string, unknown>;
  grabpay?: Record<string, unknown>;
  ideal?: Record<string, unknown>;
  interac_present?: Record<string, unknown>;
  klarna?: Record<string, unknown>;
  konbini?: Record<string, unknown>;
  link?: Record<string, unknown>;
  mobilepay?: Record<string, unknown>;
  multibanco?: Record<string, unknown>;
  oxxo?: Record<string, unknown>;
  p24?: Record<string, unknown>;
  paynow?: Record<string, unknown>;
  paypal?: Record<string, unknown>;
  pix?: Record<string, unknown>;
  promptpay?: Record<string, unknown>;
  revolut_pay?: Record<string, unknown>;
  sepa_debit?: Record<string, unknown>;
  sofort?: Record<string, unknown>;
  swish?: Record<string, unknown>;
  twint?: Record<string, unknown>;
  us_bank_account?: Record<string, unknown>;
  wechat_pay?: Record<string, unknown>;
  zip?: Record<string, unknown>;
}

export interface PaymentMethodCreateParams {
  type: PaymentMethodType;
  billing_details?: {
    address?: Address;
    email?: string;
    name?: string;
    phone?: string;
  };
  metadata?: Metadata;
  acss_debit?: { account_number: string; institution_number: string; transit_number: string };
  affirm?: Record<string, unknown>;
  afterpay_clearpay?: Record<string, unknown>;
  alipay?: Record<string, unknown>;
  amazon_pay?: Record<string, unknown>;
  au_becs_debit?: { account_number: string; bsb_number: string };
  bacs_debit?: { account_number?: string; sort_code?: string };
  bancontact?: Record<string, unknown>;
  blik?: Record<string, unknown>;
  boleto?: { tax_id: string };
  card?: { number: string; exp_month: number; exp_year: number; cvc?: string } | { token: string };
  cashapp?: Record<string, unknown>;
  customer_balance?: Record<string, unknown>;
  eps?: { bank?: string };
  fpx?: { bank: string };
  giropay?: Record<string, unknown>;
  grabpay?: Record<string, unknown>;
  ideal?: { bank?: string };
  interac_present?: Record<string, unknown>;
  klarna?: { dob?: { day: number; month: number; year: number } };
  konbini?: Record<string, unknown>;
  link?: Record<string, unknown>;
  mobilepay?: Record<string, unknown>;
  multibanco?: Record<string, unknown>;
  oxxo?: Record<string, unknown>;
  p24?: { bank?: string };
  paynow?: Record<string, unknown>;
  paypal?: Record<string, unknown>;
  pix?: Record<string, unknown>;
  promptpay?: Record<string, unknown>;
  revolut_pay?: Record<string, unknown>;
  sepa_debit?: { iban: string };
  sofort?: { country: string };
  swish?: Record<string, unknown>;
  twint?: Record<string, unknown>;
  us_bank_account?: { account_holder_type?: 'company' | 'individual'; account_number?: string; account_type?: 'checking' | 'savings'; financial_connections_account?: string; routing_number?: string };
  wechat_pay?: Record<string, unknown>;
  zip?: Record<string, unknown>;
}

export interface PaymentMethodUpdateParams {
  billing_details?: {
    address?: Address | '';
    email?: string | '';
    name?: string | '';
    phone?: string | '';
  };
  card?: { exp_month?: number; exp_year?: number };
  link?: Record<string, unknown>;
  metadata?: Metadata;
  us_bank_account?: { account_holder_type?: 'company' | 'individual' };
}

export interface PaymentMethodAttachParams {
  customer: string;
}

export interface PaymentMethodListOptions extends ListOptions {
  customer: string;
  type: PaymentMethodType;
}

// ============================================
// Charge Types
// ============================================

export type ChargeStatus = 'failed' | 'pending' | 'succeeded';

export interface ChargeOutcome {
  network_status?: string;
  reason?: string;
  risk_level?: string;
  risk_score?: number;
  rule?: string | { action: string; id: string; predicate: string };
  seller_message?: string;
  type: string;
}

export interface Charge {
  id: string;
  object: 'charge';
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  application?: string;
  application_fee?: string;
  application_fee_amount?: number;
  balance_transaction?: string;
  billing_details: {
    address?: Address;
    email?: string;
    name?: string;
    phone?: string;
  };
  calculated_statement_descriptor?: string;
  captured: boolean;
  created: number;
  currency: string;
  customer?: string | Customer;
  description?: string;
  destination?: string;
  dispute?: string;
  disputed: boolean;
  failure_balance_transaction?: string;
  failure_code?: string;
  failure_message?: string;
  fraud_details?: { stripe_report?: string; user_report?: string };
  invoice?: string | Invoice;
  livemode: boolean;
  metadata: Metadata;
  on_behalf_of?: string;
  outcome?: ChargeOutcome;
  paid: boolean;
  payment_intent?: string | PaymentIntent;
  payment_method?: string;
  payment_method_details?: Record<string, unknown>;
  radar_options?: Record<string, unknown>;
  receipt_email?: string;
  receipt_number?: string;
  receipt_url?: string;
  refunded: boolean;
  refunds?: StripeList<Refund>;
  review?: string;
  shipping?: Shipping;
  source?: PaymentSource;
  source_transfer?: string;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  status: ChargeStatus;
  transfer?: string;
  transfer_data?: { amount?: number; destination: string };
  transfer_group?: string;
}

export interface ChargeCreateParams {
  amount: number;
  currency: string;
  customer?: string;
  description?: string;
  metadata?: Metadata;
  on_behalf_of?: string;
  receipt_email?: string;
  shipping?: Shipping;
  source?: string;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  transfer_data?: { amount?: number; destination: string };
  transfer_group?: string;
  capture?: boolean;
  application_fee_amount?: number;
  radar_options?: { session?: string };
}

export interface ChargeUpdateParams {
  customer?: string;
  description?: string;
  fraud_details?: { user_report: 'fraudulent' | 'safe' };
  metadata?: Metadata;
  receipt_email?: string;
  shipping?: Shipping;
  transfer_group?: string;
}

export interface ChargeCaptureParams {
  amount?: number;
  application_fee_amount?: number;
  receipt_email?: string;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  transfer_data?: { amount?: number };
  transfer_group?: string;
}

export interface ChargeListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  customer?: string;
  payment_intent?: string;
  transfer_group?: string;
}

// ============================================
// Invoice Types
// ============================================

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
export type InvoiceBillingReason =
  | 'automatic_pending_invoice_item_invoice'
  | 'manual'
  | 'quote_accept'
  | 'subscription'
  | 'subscription_create'
  | 'subscription_cycle'
  | 'subscription_threshold'
  | 'subscription_update'
  | 'upcoming';

export interface InvoiceLineItem {
  id: string;
  object: 'line_item';
  amount: number;
  amount_excluding_tax?: number;
  currency: string;
  description?: string;
  discount_amounts?: { amount: number; discount: string }[];
  discountable: boolean;
  discounts?: (string | Discount)[];
  invoice_item?: string;
  livemode: boolean;
  metadata: Metadata;
  period: { end: number; start: number };
  plan?: Plan;
  price?: Price;
  proration: boolean;
  proration_details?: { credited_items?: { invoice: string; invoice_line_items: string[] } };
  quantity?: number;
  subscription?: string;
  subscription_item?: string;
  tax_amounts?: { amount: number; inclusive: boolean; tax_rate: string | TaxRate; taxability_reason?: string; taxable_amount?: number }[];
  tax_rates?: TaxRate[];
  type: 'invoiceitem' | 'subscription';
  unit_amount_excluding_tax?: string;
}

export interface InvoicePaymentSettings {
  default_mandate?: string;
  payment_method_options?: Record<string, unknown>;
  payment_method_types?: string[];
}

export interface Invoice {
  id: string;
  object: 'invoice';
  account_country?: string;
  account_name?: string;
  account_tax_ids?: string[];
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  amount_shipping: number;
  application?: string;
  application_fee_amount?: number;
  attempt_count: number;
  attempted: boolean;
  auto_advance: boolean;
  automatic_tax: { enabled: boolean; liability?: { type: string; account?: string }; status?: string };
  billing_reason?: InvoiceBillingReason;
  charge?: string | Charge;
  collection_method: CollectionMethod;
  created: number;
  currency: string;
  custom_fields?: { name: string; value: string }[];
  customer?: string | Customer;
  customer_address?: Address;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_shipping?: Shipping;
  customer_tax_exempt?: 'exempt' | 'none' | 'reverse';
  customer_tax_ids?: { type: string; value?: string }[];
  default_payment_method?: string | PaymentMethod;
  default_source?: string;
  default_tax_rates: TaxRate[];
  description?: string;
  discount?: Discount;
  discounts?: (string | Discount)[];
  due_date?: number;
  effective_at?: number;
  ending_balance?: number;
  footer?: string;
  from_invoice?: { action: string; invoice: string | Invoice };
  hosted_invoice_url?: string;
  invoice_pdf?: string;
  issuer: { type: 'account' | 'self'; account?: string };
  last_finalization_error?: { code?: string; message: string; param?: string; type: string };
  latest_revision?: string | Invoice;
  lines: StripeList<InvoiceLineItem>;
  livemode: boolean;
  metadata: Metadata;
  next_payment_attempt?: number;
  number?: string;
  on_behalf_of?: string;
  paid: boolean;
  paid_out_of_band: boolean;
  payment_intent?: string | PaymentIntent;
  payment_settings: InvoicePaymentSettings;
  period_end: number;
  period_start: number;
  post_payment_credit_notes_amount: number;
  pre_payment_credit_notes_amount: number;
  quote?: string;
  receipt_number?: string;
  rendering?: { amount_tax_display?: string; pdf?: { page_size?: string } };
  shipping_cost?: { amount_subtotal: number; amount_tax: number; amount_total: number; shipping_rate?: string };
  shipping_details?: Shipping;
  starting_balance: number;
  statement_descriptor?: string;
  status?: InvoiceStatus;
  status_transitions: { finalized_at?: number; marked_uncollectible_at?: number; paid_at?: number; voided_at?: number };
  subscription?: string | Subscription;
  subscription_details?: { metadata?: Metadata };
  subscription_proration_date?: number;
  subtotal: number;
  subtotal_excluding_tax?: number;
  tax?: number;
  test_clock?: string;
  threshold_reason?: { amount_gte?: number; item_reasons: { line_item_ids: string[]; usage_gte: number }[] };
  total: number;
  total_discount_amounts?: { amount: number; discount: string }[];
  total_excluding_tax?: number;
  total_tax_amounts: { amount: number; inclusive: boolean; tax_rate: string | TaxRate; taxability_reason?: string; taxable_amount?: number }[];
  transfer_data?: { amount?: number; destination: string };
  webhooks_delivered_at?: number;
}

export interface InvoiceCreateParams {
  customer?: string;
  auto_advance?: boolean;
  automatic_tax?: { enabled: boolean; liability?: { type: string; account?: string } };
  collection_method?: CollectionMethod;
  currency?: string;
  custom_fields?: { name: string; value: string }[];
  days_until_due?: number;
  default_payment_method?: string;
  default_source?: string;
  default_tax_rates?: string[];
  description?: string;
  discounts?: { coupon?: string; discount?: string; promotion_code?: string }[];
  due_date?: number;
  effective_at?: number;
  footer?: string;
  from_invoice?: { action: 'revision'; invoice: string };
  issuer?: { type: 'account' | 'self'; account?: string };
  metadata?: Metadata;
  number?: string;
  on_behalf_of?: string;
  payment_settings?: {
    default_mandate?: string;
    payment_method_options?: Record<string, unknown>;
    payment_method_types?: string[];
  };
  pending_invoice_items_behavior?: 'exclude' | 'include' | 'include_and_require';
  rendering?: { amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax'; pdf?: { page_size?: 'a4' | 'auto' | 'letter' } };
  shipping_cost?: { shipping_rate?: string; shipping_rate_data?: { display_name: string; fixed_amount?: { amount: number; currency: string }; type?: 'fixed_amount' } };
  shipping_details?: Shipping;
  statement_descriptor?: string;
  subscription?: string;
  transfer_data?: { amount?: number; destination: string };
}

export interface InvoiceUpdateParams {
  auto_advance?: boolean;
  automatic_tax?: { enabled: boolean; liability?: { type: string; account?: string } };
  collection_method?: CollectionMethod;
  custom_fields?: { name: string; value: string }[] | '';
  days_until_due?: number;
  default_payment_method?: string | '';
  default_source?: string | '';
  default_tax_rates?: string[] | '';
  description?: string | '';
  discounts?: { coupon?: string; discount?: string; promotion_code?: string }[] | '';
  due_date?: number;
  effective_at?: number | '';
  footer?: string | '';
  issuer?: { type: 'account' | 'self'; account?: string };
  metadata?: Metadata;
  number?: string | '';
  on_behalf_of?: string | '';
  payment_settings?: {
    default_mandate?: string | '';
    payment_method_options?: Record<string, unknown> | '';
    payment_method_types?: string[] | '';
  };
  rendering?: { amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax' | ''; pdf?: { page_size?: 'a4' | 'auto' | 'letter' } };
  shipping_cost?: { shipping_rate?: string; shipping_rate_data?: { display_name: string; fixed_amount?: { amount: number; currency: string }; type?: 'fixed_amount' } } | '';
  shipping_details?: Shipping | '';
  statement_descriptor?: string | '';
  transfer_data?: { amount?: number; destination: string } | '';
}

export interface InvoiceFinalizeParams {
  auto_advance?: boolean;
}

export interface InvoicePayParams {
  forgive?: boolean;
  mandate?: string;
  off_session?: boolean;
  paid_out_of_band?: boolean;
  payment_method?: string;
  source?: string;
}

export interface InvoiceSendParams {
  // No additional params
}

export interface InvoiceVoidParams {
  // No additional params
}

export interface InvoiceMarkUncollectibleParams {
  // No additional params
}

export interface InvoiceListOptions extends ListOptions {
  collection_method?: CollectionMethod;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  customer?: string;
  due_date?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  status?: InvoiceStatus;
  subscription?: string;
}

// ============================================
// Invoice Item Types
// ============================================

export interface InvoiceItem {
  id: string;
  object: 'invoiceitem';
  amount: number;
  currency: string;
  customer: string | Customer;
  date: number;
  description?: string;
  discountable: boolean;
  discounts?: (string | Discount)[];
  invoice?: string | Invoice;
  livemode: boolean;
  metadata: Metadata;
  period: { end: number; start: number };
  plan?: Plan;
  price?: Price;
  proration: boolean;
  quantity: number;
  subscription?: string | Subscription;
  subscription_item?: string;
  tax_rates?: TaxRate[];
  test_clock?: string;
  unit_amount?: number;
  unit_amount_decimal?: string;
}

export interface InvoiceItemCreateParams {
  customer: string;
  amount?: number;
  currency?: string;
  description?: string;
  discountable?: boolean;
  discounts?: { coupon?: string; discount?: string; promotion_code?: string }[];
  invoice?: string;
  metadata?: Metadata;
  period?: { end: number; start: number };
  price?: string;
  price_data?: {
    currency: string;
    product: string;
    unit_amount?: number;
    unit_amount_decimal?: string;
  };
  quantity?: number;
  subscription?: string;
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified';
  tax_code?: string;
  tax_rates?: string[];
  unit_amount?: number;
  unit_amount_decimal?: string;
}

export interface InvoiceItemUpdateParams {
  amount?: number;
  description?: string;
  discountable?: boolean;
  discounts?: { coupon?: string; discount?: string; promotion_code?: string }[] | '';
  metadata?: Metadata;
  period?: { end: number; start: number };
  price?: string;
  price_data?: {
    currency: string;
    product: string;
    unit_amount?: number;
    unit_amount_decimal?: string;
  };
  quantity?: number;
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified';
  tax_code?: string | '';
  tax_rates?: string[] | '';
  unit_amount?: number;
  unit_amount_decimal?: string;
}

export interface InvoiceItemListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  customer?: string;
  invoice?: string;
  pending?: boolean;
}

// ============================================
// Coupon Types
// ============================================

export type CouponDuration = 'forever' | 'once' | 'repeating';

export interface Coupon {
  id: string;
  object: 'coupon';
  amount_off?: number;
  applies_to?: { products: string[] };
  created: number;
  currency?: string;
  currency_options?: Record<string, { amount_off: number }>;
  duration: CouponDuration;
  duration_in_months?: number;
  livemode: boolean;
  max_redemptions?: number;
  metadata: Metadata;
  name?: string;
  percent_off?: number;
  redeem_by?: number;
  times_redeemed: number;
  valid: boolean;
}

export interface CouponCreateParams {
  id?: string;
  amount_off?: number;
  applies_to?: { products: string[] };
  currency?: string;
  currency_options?: Record<string, { amount_off: number }>;
  duration: CouponDuration;
  duration_in_months?: number;
  max_redemptions?: number;
  metadata?: Metadata;
  name?: string;
  percent_off?: number;
  redeem_by?: number;
}

export interface CouponUpdateParams {
  metadata?: Metadata;
  name?: string;
  currency_options?: Record<string, { amount_off: number }>;
}

export interface CouponListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
}

// ============================================
// Promotion Code Types
// ============================================

export interface PromotionCode {
  id: string;
  object: 'promotion_code';
  active: boolean;
  code: string;
  coupon: Coupon;
  created: number;
  customer?: string | Customer;
  expires_at?: number;
  livemode: boolean;
  max_redemptions?: number;
  metadata: Metadata;
  restrictions: {
    currency_options?: Record<string, { minimum_amount: number }>;
    first_time_transaction: boolean;
    minimum_amount?: number;
    minimum_amount_currency?: string;
  };
  times_redeemed: number;
}

export interface PromotionCodeCreateParams {
  coupon: string;
  active?: boolean;
  code?: string;
  customer?: string;
  expires_at?: number;
  max_redemptions?: number;
  metadata?: Metadata;
  restrictions?: {
    currency_options?: Record<string, { minimum_amount: number }>;
    first_time_transaction?: boolean;
    minimum_amount?: number;
    minimum_amount_currency?: string;
  };
}

export interface PromotionCodeUpdateParams {
  active?: boolean;
  metadata?: Metadata;
  restrictions?: {
    currency_options?: Record<string, { minimum_amount: number }>;
  };
}

export interface PromotionCodeListOptions extends ListOptions {
  active?: boolean;
  code?: string;
  coupon?: string;
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  customer?: string;
}

// ============================================
// Event Types
// ============================================

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

// ============================================
// Webhook Endpoint Types
// ============================================

export interface WebhookEndpoint {
  id: string;
  object: 'webhook_endpoint';
  api_version?: string;
  application?: string;
  created: number;
  description?: string;
  enabled_events: string[];
  livemode: boolean;
  metadata: Metadata;
  secret?: string;
  status: 'disabled' | 'enabled';
  url: string;
}

export interface WebhookEndpointCreateParams {
  url: string;
  enabled_events: string[];
  api_version?: string;
  description?: string;
  metadata?: Metadata;
}

export interface WebhookEndpointUpdateParams {
  description?: string;
  disabled?: boolean;
  enabled_events?: string[];
  metadata?: Metadata;
  url?: string;
}

export interface WebhookEndpointListOptions extends ListOptions {
  // No additional filter options
}

// ============================================
// Supporting Types
// ============================================

export interface Discount {
  id: string;
  object: 'discount';
  checkout_session?: string;
  coupon: Coupon;
  customer?: string | Customer;
  end?: number;
  invoice?: string;
  invoice_item?: string;
  promotion_code?: string | PromotionCode;
  start: number;
  subscription?: string;
  subscription_item?: string;
}

export interface TaxRate {
  id: string;
  object: 'tax_rate';
  active: boolean;
  country?: string;
  created: number;
  description?: string;
  display_name: string;
  effective_percentage?: number;
  inclusive: boolean;
  jurisdiction?: string;
  jurisdiction_level?: string;
  livemode: boolean;
  metadata: Metadata;
  percentage: number;
  state?: string;
  tax_type?: string;
}

export interface Plan {
  id: string;
  object: 'plan';
  active: boolean;
  aggregate_usage?: 'last_during_period' | 'last_ever' | 'max' | 'sum';
  amount?: number;
  amount_decimal?: string;
  billing_scheme: 'per_unit' | 'tiered';
  created: number;
  currency: string;
  interval: RecurringInterval;
  interval_count: number;
  livemode: boolean;
  metadata: Metadata;
  meter?: string;
  nickname?: string;
  product?: string | Product;
  tiers?: PriceTier[];
  tiers_mode?: 'graduated' | 'volume';
  transform_usage?: { divide_by: number; round: 'down' | 'up' };
  trial_period_days?: number;
  usage_type: 'licensed' | 'metered';
}

export interface Refund {
  id: string;
  object: 'refund';
  amount: number;
  balance_transaction?: string;
  charge?: string | Charge;
  created: number;
  currency: string;
  destination_details?: Record<string, unknown>;
  failure_balance_transaction?: string;
  failure_reason?: string;
  instructions_email?: string;
  metadata: Metadata;
  next_action?: Record<string, unknown>;
  payment_intent?: string | PaymentIntent;
  reason?: 'duplicate' | 'expired_uncaptured_charge' | 'fraudulent' | 'requested_by_customer';
  receipt_number?: string;
  source_transfer_reversal?: string;
  status?: 'canceled' | 'failed' | 'pending' | 'requires_action' | 'succeeded';
  transfer_reversal?: string;
}

export interface PaymentSource {
  id: string;
  object: string;
  // Generic payment source - varies by type
  [key: string]: unknown;
}

// ============================================
// Checkout Session Types
// ============================================

export type CheckoutSessionMode = 'payment' | 'setup' | 'subscription';
export type CheckoutSessionStatus = 'complete' | 'expired' | 'open';
export type CheckoutSessionPaymentStatus = 'no_payment_required' | 'paid' | 'unpaid';

export interface CheckoutSessionLineItem {
  id: string;
  object: 'item';
  amount_discount: number;
  amount_subtotal: number;
  amount_tax: number;
  amount_total: number;
  currency: string;
  description: string;
  price?: Price;
  quantity?: number;
}

export interface CheckoutSession {
  id: string;
  object: 'checkout.session';
  after_expiration?: { recovery?: { allow_promotion_codes: boolean; enabled: boolean; expires_at?: number; url?: string } };
  allow_promotion_codes?: boolean;
  amount_subtotal?: number;
  amount_total?: number;
  automatic_tax: { enabled: boolean; liability?: { type: string; account?: string }; status?: string };
  billing_address_collection?: 'auto' | 'required';
  cancel_url?: string;
  client_reference_id?: string;
  client_secret?: string;
  consent?: { promotions?: 'opt_in' | 'opt_out'; terms_of_service?: 'accepted' };
  consent_collection?: { payment_method_reuse_agreement?: { position: string }; promotions?: 'auto' | 'none'; terms_of_service?: 'none' | 'required' };
  created: number;
  currency?: string;
  currency_conversion?: { amount_subtotal: number; amount_total: number; fx_rate: string; source_currency: string };
  custom_fields: { dropdown?: { options: { label: string; value: string }[]; value?: string }; key: string; label: { custom?: string; type: string }; numeric?: { maximum_length?: number; minimum_length?: number; value?: string }; optional: boolean; text?: { maximum_length?: number; minimum_length?: number; value?: string }; type: string }[];
  custom_text?: { after_submit?: { message: string }; shipping_address?: { message: string }; submit?: { message: string }; terms_of_service_acceptance?: { message: string } };
  customer?: string | Customer;
  customer_creation?: 'always' | 'if_required';
  customer_details?: { address?: Address; email?: string; name?: string; phone?: string; tax_exempt?: 'exempt' | 'none' | 'reverse'; tax_ids?: { type: string; value?: string }[] };
  customer_email?: string;
  expires_at: number;
  invoice?: string | Invoice;
  invoice_creation?: { enabled: boolean; invoice_data?: { account_tax_ids?: string[]; custom_fields?: { name: string; value: string }[]; description?: string; footer?: string; issuer?: { type: string; account?: string }; metadata?: Metadata; rendering_options?: { amount_tax_display?: string } } };
  line_items?: StripeList<CheckoutSessionLineItem>;
  livemode: boolean;
  locale?: string;
  metadata: Metadata;
  mode: CheckoutSessionMode;
  payment_intent?: string | PaymentIntent;
  payment_link?: string;
  payment_method_collection?: 'always' | 'if_required';
  payment_method_configuration_details?: { id: string; parent?: string };
  payment_method_options?: Record<string, unknown>;
  payment_method_types: string[];
  payment_status: CheckoutSessionPaymentStatus;
  phone_number_collection?: { enabled: boolean };
  recovered_from?: string;
  redirect_on_completion?: 'always' | 'if_required' | 'never';
  return_url?: string;
  saved_payment_method_options?: { allow_redisplay_filters?: string[]; payment_method_remove?: string; payment_method_save?: string };
  setup_intent?: string;
  shipping_address_collection?: { allowed_countries: string[] };
  shipping_cost?: { amount_subtotal: number; amount_tax: number; amount_total: number; shipping_rate?: string };
  shipping_details?: Shipping;
  shipping_options?: { shipping_amount: number; shipping_rate: string }[];
  status?: CheckoutSessionStatus;
  submit_type?: 'auto' | 'book' | 'donate' | 'pay';
  subscription?: string | Subscription;
  success_url?: string;
  tax_id_collection?: { enabled: boolean; required?: 'if_supported' | 'never' };
  total_details?: { amount_discount: number; amount_shipping?: number; amount_tax: number };
  ui_mode?: 'custom' | 'embedded' | 'hosted';
  url?: string;
}

export interface CheckoutSessionCreateParams {
  mode: CheckoutSessionMode;
  cancel_url?: string;
  success_url?: string;
  return_url?: string;
  ui_mode?: 'embedded' | 'hosted';
  line_items?: {
    price?: string;
    price_data?: {
      currency: string;
      product?: string;
      product_data?: { name: string; description?: string; images?: string[]; metadata?: Metadata };
      unit_amount?: number;
      unit_amount_decimal?: string;
      recurring?: { interval: RecurringInterval; interval_count?: number };
    };
    quantity?: number;
    adjustable_quantity?: { enabled: boolean; maximum?: number; minimum?: number };
  }[];
  customer?: string;
  customer_email?: string;
  customer_creation?: 'always' | 'if_required';
  client_reference_id?: string;
  metadata?: Metadata;
  allow_promotion_codes?: boolean;
  discounts?: { coupon?: string; promotion_code?: string }[];
  automatic_tax?: { enabled: boolean; liability?: { type: string; account?: string } };
  billing_address_collection?: 'auto' | 'required';
  consent_collection?: { payment_method_reuse_agreement?: { position: 'auto' | 'hidden' }; promotions?: 'auto' | 'none'; terms_of_service?: 'none' | 'required' };
  currency?: string;
  custom_fields?: { dropdown?: { options: { label: string; value: string }[] }; key: string; label: { custom: string; type: 'custom' }; numeric?: { maximum_length?: number; minimum_length?: number }; optional?: boolean; text?: { maximum_length?: number; minimum_length?: number }; type: 'dropdown' | 'numeric' | 'text' }[];
  custom_text?: { after_submit?: { message: string }; shipping_address?: { message: string }; submit?: { message: string }; terms_of_service_acceptance?: { message: string } };
  expires_at?: number;
  invoice_creation?: { enabled: boolean; invoice_data?: { account_tax_ids?: string[]; custom_fields?: { name: string; value: string }[]; description?: string; footer?: string; issuer?: { type: string; account?: string }; metadata?: Metadata; rendering_options?: { amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax' } } };
  locale?: string;
  payment_intent_data?: {
    application_fee_amount?: number;
    capture_method?: CaptureMethod;
    description?: string;
    metadata?: Metadata;
    on_behalf_of?: string;
    receipt_email?: string;
    setup_future_usage?: SetupFutureUsage;
    shipping?: Shipping;
    statement_descriptor?: string;
    statement_descriptor_suffix?: string;
    transfer_data?: { amount?: number; destination: string };
    transfer_group?: string;
  };
  payment_method_collection?: 'always' | 'if_required';
  payment_method_configuration?: string;
  payment_method_options?: Record<string, unknown>;
  payment_method_types?: string[];
  phone_number_collection?: { enabled: boolean };
  redirect_on_completion?: 'always' | 'if_required' | 'never';
  saved_payment_method_options?: { allow_redisplay_filters?: ('always' | 'limited' | 'unspecified')[]; payment_method_remove?: 'disabled' | 'enabled'; payment_method_save?: 'disabled' | 'enabled' };
  shipping_address_collection?: { allowed_countries: string[] };
  shipping_options?: { shipping_rate?: string; shipping_rate_data?: { display_name: string; fixed_amount?: { amount: number; currency: string }; type?: 'fixed_amount'; delivery_estimate?: { maximum?: { unit: 'business_day' | 'day' | 'hour' | 'month' | 'week'; value: number }; minimum?: { unit: 'business_day' | 'day' | 'hour' | 'month' | 'week'; value: number } } } }[];
  submit_type?: 'auto' | 'book' | 'donate' | 'pay';
  subscription_data?: {
    application_fee_percent?: number;
    billing_cycle_anchor?: number;
    default_tax_rates?: string[];
    description?: string;
    invoice_settings?: { issuer?: { type: string; account?: string } };
    metadata?: Metadata;
    on_behalf_of?: string;
    proration_behavior?: ProrationBehavior;
    transfer_data?: { amount_percent?: number; destination: string };
    trial_end?: number;
    trial_period_days?: number;
    trial_settings?: { end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' } };
  };
  tax_id_collection?: { enabled: boolean; required?: 'if_supported' | 'never' };
}

export interface CheckoutSessionListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  customer?: string;
  customer_details?: { email: string };
  payment_intent?: string;
  payment_link?: string;
  status?: CheckoutSessionStatus;
  subscription?: string;
}

// ============================================
// Payment Link Types
// ============================================

export interface PaymentLink {
  id: string;
  object: 'payment_link';
  active: boolean;
  after_completion: { hosted_confirmation?: { custom_message?: string }; redirect?: { url: string }; type: 'hosted_confirmation' | 'redirect' };
  allow_promotion_codes: boolean;
  application?: string;
  application_fee_amount?: number;
  application_fee_percent?: number;
  automatic_tax: { enabled: boolean; liability?: { type: string; account?: string } };
  billing_address_collection: 'auto' | 'required';
  consent_collection?: { payment_method_reuse_agreement?: { position: string }; promotions?: 'auto' | 'none'; terms_of_service?: 'none' | 'required' };
  currency: string;
  custom_fields: { dropdown?: { options: { label: string; value: string }[]; value?: string }; key: string; label: { custom?: string; type: string }; numeric?: { maximum_length?: number; minimum_length?: number; value?: string }; optional: boolean; text?: { maximum_length?: number; minimum_length?: number; value?: string }; type: string }[];
  custom_text?: { after_submit?: { message: string }; shipping_address?: { message: string }; submit?: { message: string }; terms_of_service_acceptance?: { message: string } };
  customer_creation: 'always' | 'if_required';
  inactive_message?: string;
  invoice_creation?: { enabled: boolean; invoice_data?: { account_tax_ids?: string[]; custom_fields?: { name: string; value: string }[]; description?: string; footer?: string; issuer?: { type: string; account?: string }; metadata?: Metadata; rendering_options?: { amount_tax_display?: string } } };
  line_items?: StripeList<CheckoutSessionLineItem>;
  livemode: boolean;
  metadata: Metadata;
  on_behalf_of?: string;
  payment_intent_data?: { capture_method?: CaptureMethod; description?: string; metadata?: Metadata; setup_future_usage?: SetupFutureUsage; statement_descriptor?: string; statement_descriptor_suffix?: string; transfer_group?: string };
  payment_method_collection: 'always' | 'if_required';
  payment_method_types?: string[];
  phone_number_collection: { enabled: boolean };
  restrictions?: { completed_sessions: { count: number; limit: number } };
  shipping_address_collection?: { allowed_countries: string[] };
  shipping_options?: { shipping_amount: number; shipping_rate: string }[];
  submit_type: 'auto' | 'book' | 'donate' | 'pay';
  subscription_data?: { description?: string; invoice_settings?: { issuer?: { type: string; account?: string } }; metadata?: Metadata; trial_period_days?: number; trial_settings?: { end_behavior: { missing_payment_method: string } } };
  tax_id_collection: { enabled: boolean; required?: 'if_supported' | 'never' };
  transfer_data?: { amount?: number; destination: string };
  url: string;
}

export interface PaymentLinkCreateParams {
  line_items: {
    price: string;
    quantity: number;
    adjustable_quantity?: { enabled: boolean; maximum?: number; minimum?: number };
  }[];
  after_completion?: { hosted_confirmation?: { custom_message?: string }; redirect?: { url: string }; type: 'hosted_confirmation' | 'redirect' };
  allow_promotion_codes?: boolean;
  application_fee_amount?: number;
  application_fee_percent?: number;
  automatic_tax?: { enabled: boolean; liability?: { type: string; account?: string } };
  billing_address_collection?: 'auto' | 'required';
  consent_collection?: { payment_method_reuse_agreement?: { position: 'auto' | 'hidden' }; promotions?: 'auto' | 'none'; terms_of_service?: 'none' | 'required' };
  currency?: string;
  custom_fields?: { dropdown?: { options: { label: string; value: string }[] }; key: string; label: { custom: string; type: 'custom' }; numeric?: { maximum_length?: number; minimum_length?: number }; optional?: boolean; text?: { maximum_length?: number; minimum_length?: number }; type: 'dropdown' | 'numeric' | 'text' }[];
  custom_text?: { after_submit?: { message: string }; shipping_address?: { message: string }; submit?: { message: string }; terms_of_service_acceptance?: { message: string } };
  customer_creation?: 'always' | 'if_required';
  inactive_message?: string;
  invoice_creation?: { enabled: boolean; invoice_data?: { account_tax_ids?: string[]; custom_fields?: { name: string; value: string }[]; description?: string; footer?: string; issuer?: { type: string; account?: string }; metadata?: Metadata; rendering_options?: { amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax' } } };
  metadata?: Metadata;
  on_behalf_of?: string;
  payment_intent_data?: { capture_method?: CaptureMethod; description?: string; metadata?: Metadata; setup_future_usage?: SetupFutureUsage; statement_descriptor?: string; statement_descriptor_suffix?: string; transfer_group?: string };
  payment_method_collection?: 'always' | 'if_required';
  payment_method_types?: string[];
  phone_number_collection?: { enabled: boolean };
  restrictions?: { completed_sessions: { limit: number } };
  shipping_address_collection?: { allowed_countries: string[] };
  shipping_options?: { shipping_rate?: string }[];
  submit_type?: 'auto' | 'book' | 'donate' | 'pay';
  subscription_data?: { description?: string; invoice_settings?: { issuer?: { type: string; account?: string } }; metadata?: Metadata; trial_period_days?: number; trial_settings?: { end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' } } };
  tax_id_collection?: { enabled: boolean; required?: 'if_supported' | 'never' };
  transfer_data?: { amount?: number; destination: string };
}

export interface PaymentLinkUpdateParams {
  active?: boolean;
  after_completion?: { hosted_confirmation?: { custom_message?: string }; redirect?: { url: string }; type: 'hosted_confirmation' | 'redirect' };
  allow_promotion_codes?: boolean;
  automatic_tax?: { enabled: boolean; liability?: { type: string; account?: string } };
  billing_address_collection?: 'auto' | 'required';
  custom_fields?: { dropdown?: { options: { label: string; value: string }[] }; key: string; label: { custom: string; type: 'custom' }; numeric?: { maximum_length?: number; minimum_length?: number }; optional?: boolean; text?: { maximum_length?: number; minimum_length?: number }; type: 'dropdown' | 'numeric' | 'text' }[] | '';
  custom_text?: { after_submit?: { message: string } | ''; shipping_address?: { message: string } | ''; submit?: { message: string } | ''; terms_of_service_acceptance?: { message: string } | '' };
  customer_creation?: 'always' | 'if_required';
  inactive_message?: string | '';
  invoice_creation?: { enabled: boolean; invoice_data?: { account_tax_ids?: string[] | ''; custom_fields?: { name: string; value: string }[] | ''; description?: string | ''; footer?: string | ''; issuer?: { type: string; account?: string }; metadata?: Metadata; rendering_options?: { amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax' | '' } } };
  line_items?: { id: string; quantity?: number; adjustable_quantity?: { enabled: boolean; maximum?: number; minimum?: number } }[];
  metadata?: Metadata;
  payment_intent_data?: { description?: string | ''; metadata?: Metadata; statement_descriptor?: string | ''; statement_descriptor_suffix?: string | ''; transfer_group?: string | '' };
  payment_method_collection?: 'always' | 'if_required';
  payment_method_types?: string[] | '';
  restrictions?: { completed_sessions: { limit: number } } | '';
  shipping_address_collection?: { allowed_countries: string[] } | '';
  subscription_data?: { invoice_settings?: { issuer?: { type: string; account?: string } }; metadata?: Metadata; trial_settings?: { end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' } } | '' };
  tax_id_collection?: { enabled: boolean; required?: 'if_supported' | 'never' };
}

export interface PaymentLinkListOptions extends ListOptions {
  active?: boolean;
}

// ============================================
// Billing Portal Types
// ============================================

export interface BillingPortalSession {
  id: string;
  object: 'billing_portal.session';
  configuration: string;
  created: number;
  customer: string;
  flow?: {
    after_completion: { hosted_confirmation?: { custom_message?: string }; redirect?: { return_url: string }; type: 'hosted_confirmation' | 'portal_homepage' | 'redirect' };
    subscription_cancel?: { retention?: { coupon_offer?: { coupon: string }; type: string }; subscription: string };
    subscription_update?: { subscription: string };
    subscription_update_confirm?: { discounts?: { coupon?: string; promotion_code?: string }[]; items: { id?: string; price?: string; quantity?: number }[]; subscription: string };
    type: 'payment_method_update' | 'subscription_cancel' | 'subscription_update' | 'subscription_update_confirm';
  };
  livemode: boolean;
  locale?: string;
  on_behalf_of?: string;
  return_url?: string;
  url: string;
}

export interface BillingPortalSessionCreateParams {
  customer: string;
  configuration?: string;
  flow_data?: {
    after_completion?: { hosted_confirmation?: { custom_message?: string }; redirect?: { return_url: string }; type: 'hosted_confirmation' | 'portal_homepage' | 'redirect' };
    subscription_cancel?: { retention?: { coupon_offer?: { coupon: string }; type: 'coupon_offer' }; subscription: string };
    subscription_update?: { subscription: string };
    subscription_update_confirm?: { discounts?: { coupon?: string; promotion_code?: string }[]; items: { id?: string; price?: string; quantity?: number }[]; subscription: string };
    type: 'payment_method_update' | 'subscription_cancel' | 'subscription_update' | 'subscription_update_confirm';
  };
  locale?: string;
  on_behalf_of?: string;
  return_url?: string;
}

export interface BillingPortalConfiguration {
  id: string;
  object: 'billing_portal.configuration';
  active: boolean;
  application?: string;
  business_profile: {
    headline?: string;
    privacy_policy_url?: string;
    terms_of_service_url?: string;
  };
  created: number;
  default_return_url?: string;
  features: {
    customer_update: { allowed_updates?: string[]; enabled: boolean };
    invoice_history: { enabled: boolean };
    payment_method_update: { enabled: boolean };
    subscription_cancel: { cancellation_reason?: { enabled: boolean; options?: string[] }; enabled: boolean; mode?: string; proration_behavior?: string };
    subscription_update: { default_allowed_updates?: string[]; enabled: boolean; proration_behavior?: string; products?: { prices: string[]; product: string }[] };
  };
  is_default: boolean;
  livemode: boolean;
  login_page: { enabled: boolean; url?: string };
  metadata: Metadata;
  updated: number;
}

export interface BillingPortalConfigurationCreateParams {
  business_profile: {
    headline?: string;
    privacy_policy_url?: string;
    terms_of_service_url?: string;
  };
  features: {
    customer_update?: { allowed_updates?: ('address' | 'email' | 'name' | 'phone' | 'shipping' | 'tax_id')[]; enabled: boolean };
    invoice_history?: { enabled: boolean };
    payment_method_update?: { enabled: boolean };
    subscription_cancel?: { cancellation_reason?: { enabled: boolean; options?: ('customer_service' | 'low_quality' | 'missing_features' | 'other' | 'switched_service' | 'too_complex' | 'too_expensive' | 'unused')[] }; enabled: boolean; mode?: 'at_period_end' | 'immediately'; proration_behavior?: 'always_invoice' | 'create_prorations' | 'none' };
    subscription_update?: { default_allowed_updates?: ('price' | 'promotion_code' | 'quantity')[]; enabled: boolean; proration_behavior?: 'always_invoice' | 'create_prorations' | 'none'; products?: { prices: string[]; product: string }[] };
  };
  default_return_url?: string;
  login_page?: { enabled: boolean };
  metadata?: Metadata;
}

export interface BillingPortalConfigurationUpdateParams {
  active?: boolean;
  business_profile?: {
    headline?: string | '';
    privacy_policy_url?: string | '';
    terms_of_service_url?: string | '';
  };
  default_return_url?: string | '';
  features?: {
    customer_update?: { allowed_updates?: ('address' | 'email' | 'name' | 'phone' | 'shipping' | 'tax_id')[] | ''; enabled?: boolean };
    invoice_history?: { enabled: boolean };
    payment_method_update?: { enabled: boolean };
    subscription_cancel?: { cancellation_reason?: { enabled: boolean; options?: ('customer_service' | 'low_quality' | 'missing_features' | 'other' | 'switched_service' | 'too_complex' | 'too_expensive' | 'unused')[] | '' }; enabled?: boolean; mode?: 'at_period_end' | 'immediately'; proration_behavior?: 'always_invoice' | 'create_prorations' | 'none' };
    subscription_update?: { default_allowed_updates?: ('price' | 'promotion_code' | 'quantity')[] | ''; enabled?: boolean; proration_behavior?: 'always_invoice' | 'create_prorations' | 'none'; products?: { prices: string[]; product: string }[] | '' };
  };
  login_page?: { enabled: boolean };
  metadata?: Metadata;
}

export interface BillingPortalConfigurationListOptions extends ListOptions {
  active?: boolean;
  is_default?: boolean;
}

// ============================================
// Deprecated Types (for backward compatibility)
// ============================================

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

export interface ExampleResource {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExampleListResponse {
  items: ExampleResource[];
  nextPageToken?: string;
  total?: number;
}

export interface ExampleCreateParams {
  name: string;
}

// ============================================
// API Error Types
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

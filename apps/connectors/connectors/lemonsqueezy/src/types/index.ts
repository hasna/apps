// Lemon Squeezy Connector Types
// Digital products, subscriptions, and license keys

// ============================================
// Configuration
// ============================================

export interface LemonSqueezyConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface JsonApiResource<T> {
  type: string;
  id: string;
  attributes: T;
  relationships?: Record<string, { data: { type: string; id: string } | null }>;
  links?: { self: string };
}

export interface JsonApiResponse<T> {
  data: JsonApiResource<T>;
  links?: { self: string };
  included?: JsonApiResource<unknown>[];
}

export interface JsonApiListResponse<T> {
  data: JsonApiResource<T>[];
  meta: {
    page: {
      currentPage: number;
      from: number;
      lastPage: number;
      perPage: number;
      to: number;
      total: number;
    };
  };
  links: {
    first: string;
    last: string;
    next?: string;
    prev?: string;
  };
  included?: JsonApiResource<unknown>[];
}

// ============================================
// User Types
// ============================================

export interface UserAttributes {
  name: string;
  email: string;
  color: string;
  avatar_url: string;
  has_custom_avatar: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Store Types
// ============================================

export interface StoreAttributes {
  name: string;
  slug: string;
  domain: string;
  url: string;
  avatar_url: string;
  plan: string;
  country: string;
  country_nicename: string;
  currency: string;
  total_sales: number;
  total_revenue: number;
  thirty_day_sales: number;
  thirty_day_revenue: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// Product Types
// ============================================

export interface ProductAttributes {
  store_id: number;
  name: string;
  slug: string;
  description: string;
  status: 'draft' | 'published';
  status_formatted: string;
  thumb_url: string | null;
  large_thumb_url: string | null;
  price: number;
  price_formatted: string;
  from_price: number | null;
  to_price: number | null;
  pay_what_you_want: boolean;
  buy_now_url: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// Variant Types
// ============================================

export interface VariantAttributes {
  product_id: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  is_subscription: boolean;
  interval: 'day' | 'week' | 'month' | 'year' | null;
  interval_count: number | null;
  has_free_trial: boolean;
  trial_interval: string | null;
  trial_interval_count: number | null;
  pay_what_you_want: boolean;
  min_price: number;
  suggested_price: number;
  has_license_keys: boolean;
  license_activation_limit: number;
  is_license_limit_unlimited: boolean;
  license_length_value: number | null;
  license_length_unit: string | null;
  is_license_length_unlimited: boolean;
  sort: number;
  status: 'pending' | 'draft' | 'published';
  status_formatted: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// Order Types
// ============================================

export interface OrderAttributes {
  store_id: number;
  customer_id: number;
  identifier: string;
  order_number: number;
  user_name: string;
  user_email: string;
  currency: string;
  currency_rate: string;
  subtotal: number;
  discount_total: number;
  tax: number;
  total: number;
  subtotal_usd: number;
  discount_total_usd: number;
  tax_usd: number;
  total_usd: number;
  tax_name: string;
  tax_rate: string;
  status: 'pending' | 'failed' | 'paid' | 'refunded';
  status_formatted: string;
  refunded: boolean;
  refunded_at: string | null;
  subtotal_formatted: string;
  discount_total_formatted: string;
  tax_formatted: string;
  total_formatted: string;
  first_order_item: {
    id: number;
    order_id: number;
    product_id: number;
    variant_id: number;
    product_name: string;
    variant_name: string;
    price: number;
    created_at: string;
    updated_at: string;
  };
  urls: {
    receipt: string;
  };
  created_at: string;
  updated_at: string;
}

// ============================================
// Subscription Types
// ============================================

export interface SubscriptionAttributes {
  store_id: number;
  customer_id: number;
  order_id: number;
  order_item_id: number;
  product_id: number;
  variant_id: number;
  product_name: string;
  variant_name: string;
  user_name: string;
  user_email: string;
  status: 'on_trial' | 'active' | 'paused' | 'past_due' | 'unpaid' | 'cancelled' | 'expired';
  status_formatted: string;
  card_brand: string;
  card_last_four: string;
  pause: {
    mode: string | null;
    resumes_at: string | null;
  } | null;
  cancelled: boolean;
  trial_ends_at: string | null;
  billing_anchor: number;
  first_subscription_item: {
    id: number;
    subscription_id: number;
    price_id: number;
    quantity: number;
    is_usage_based: boolean;
    created_at: string;
    updated_at: string;
  };
  urls: {
    update_payment_method: string;
    customer_portal: string;
  };
  renews_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// Customer Types
// ============================================

export interface CustomerAttributes {
  store_id: number;
  name: string;
  email: string;
  status: 'subscribed' | 'unsubscribed' | 'archived' | 'requires_verification' | 'invalid_email' | 'bounced';
  status_formatted: string;
  city: string | null;
  region: string | null;
  country: string;
  total_revenue_currency: number;
  mrr: number;
  urls: {
    customer_portal: string;
  };
  created_at: string;
  updated_at: string;
}

// ============================================
// License Key Types
// ============================================

export interface LicenseKeyAttributes {
  store_id: number;
  customer_id: number;
  order_id: number;
  order_item_id: number;
  product_id: number;
  user_name: string;
  user_email: string;
  key: string;
  key_short: string;
  activation_limit: number;
  instances_count: number;
  disabled: boolean;
  status: 'inactive' | 'active' | 'expired' | 'disabled';
  status_formatted: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// License Key Instance Types
// ============================================

export interface LicenseKeyInstanceAttributes {
  license_key_id: number;
  identifier: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// Discount Types
// ============================================

export interface DiscountAttributes {
  store_id: number;
  name: string;
  code: string;
  amount: number;
  amount_type: 'percent' | 'fixed';
  is_limited_to_products: boolean;
  is_limited_redemptions: boolean;
  max_redemptions: number;
  starts_at: string | null;
  expires_at: string | null;
  duration: 'once' | 'repeating' | 'forever';
  duration_in_months: number | null;
  status: 'draft' | 'published';
  status_formatted: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// Webhook Types
// ============================================

export interface WebhookAttributes {
  store_id: number;
  url: string;
  events: string[];
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// API Error Types
// ============================================

export interface LemonSqueezyError {
  title: string;
  detail: string;
  status: string;
}

export class LemonSqueezyApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: LemonSqueezyError[];

  constructor(message: string, statusCode: number, errors?: LemonSqueezyError[]) {
    super(message);
    this.name = 'LemonSqueezyApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

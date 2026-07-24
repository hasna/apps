// Smile.io Connector Types
// Modeled on the public Smile.io REST API (https://api.smile.io/v1).

// ============================================
// Configuration
// ============================================

export interface SmileConfig {
  /** Private API key. Sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Override the API base URL. Defaults to https://api.smile.io/v1 */
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Pagination
// ============================================

/**
 * Cursor-based pagination metadata returned by list endpoints
 * (customers, points_transactions, earning_rules, reward_fulfillments).
 */
export interface PaginationMetadata {
  next_cursor: string | null;
  previous_cursor: string | null;
}

export interface CursorListOptions {
  limit?: number;
  cursor?: string;
  updated_at_min?: string;
}

// ============================================
// Customers
// ============================================

export type CustomerState = 'candidate' | 'member' | 'disabled';

export interface VipStatus {
  vip_tier_id: number | null;
  vip_tier_expires_at: string | null;
  progress_value: number;
  current_vip_period_end: string | null;
  delta_to_retain_vip_tier: number | null;
  next_vip_tier_id: number | null;
  delta_to_next_vip_tier: number | null;
}

export interface Customer {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  state: CustomerState;
  date_of_birth?: string | null;
  points_balance: number;
  referral_url?: string | null;
  vip_status?: VipStatus | null;
  created_at: string;
  updated_at: string;
}

export interface ListCustomersOptions extends CursorListOptions {
  email?: string;
  state?: CustomerState;
  /** Comma-separated list of nested objects to include, e.g. `vip_status`. */
  include?: string;
}

export interface ListCustomersResponse {
  customers: Customer[];
  metadata: PaginationMetadata;
}

export interface CustomerResponse {
  customer: Customer;
}

// ============================================
// Customer Identities
// ============================================

export interface CustomerIdentity {
  id: number;
  email: string;
  distinct_id: string;
  first_name: string | null;
  last_name: string | null;
  customer_id: number;
  properties?: Record<string, unknown>;
}

export interface CreateCustomerIdentityInput {
  email: string;
  distinct_id: string;
  first_name?: string;
  last_name?: string;
  properties?: Record<string, unknown>;
}

export interface CustomerIdentityResponse {
  customer_identity: CustomerIdentity;
}

// ============================================
// Points Transactions
// ============================================

export interface PointsTransaction {
  id: number;
  customer_id: number;
  points_change: number;
  description: string | null;
  internal_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListPointsTransactionsOptions extends CursorListOptions {
  customer_id?: number;
}

export interface CreatePointsTransactionInput {
  customer_id: number;
  /** Positive to add points, negative to subtract. */
  points_change: number;
  description?: string;
  internal_note?: string;
}

export interface ListPointsTransactionsResponse {
  points_transactions: PointsTransaction[];
  metadata: PaginationMetadata;
}

export interface PointsTransactionResponse {
  points_transaction: PointsTransaction;
}

// ============================================
// Points Products
// ============================================

export type ExchangeType = 'fixed' | 'variable';

export interface PointsProductReward {
  id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
}

export interface PointsProduct {
  id: number;
  exchange_type: ExchangeType;
  exchange_description: string;
  points_price?: number | null;
  variable_points_step?: number | null;
  variable_points_step_reward_value?: number | null;
  variable_points_min?: number | null;
  variable_points_max?: number | null;
  reward: PointsProductReward;
  created_at: string;
  updated_at: string;
}

export interface ListPointsProductsOptions {
  exchange_type?: ExchangeType;
  page?: number;
  page_size?: number;
}

export interface ListPointsProductsResponse {
  points_products: PointsProduct[];
}

export interface PointsProductResponse {
  points_product: PointsProduct;
}

export interface PurchasePointsProductInput {
  customer_id: number;
  /** Only applies when the product's exchange_type is `variable`. */
  points_to_spend?: number;
}

export interface PointsPurchase {
  id: number;
  customer_id: number;
  points_product_id: number;
  points_spent: number;
  reward_fulfillment: RewardFulfillment;
  created_at: string;
  updated_at: string;
}

export interface PointsPurchaseResponse {
  points_purchase: PointsPurchase;
}

// ============================================
// Activities
// ============================================

export interface Activity {
  id: number;
  customer_id: number;
  token: string;
  distinct_id: string | null;
  created_on_origin_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateActivityInput {
  /** Token identifying the performed activity. */
  token: string;
  /** One of customer_id / customer_email is required. */
  customer_id?: number;
  customer_email?: string;
  distinct_id?: string;
  created_on_origin_at?: string;
}

export interface ActivityResponse {
  activity: Activity;
}

// ============================================
// Earning Rules
// ============================================

export type RewardType = 'points';

export interface RewardValue {
  fixed?: { value: number };
  variable?: { value: number; per_amount: number };
}

export interface EarningLimit {
  max: number;
  type: 'rolling' | 'lifetime';
  rolling?: Record<string, unknown>;
}

export interface EarningRule {
  id: number;
  name: string;
  image_url: string;
  action_text: string | null;
  action_url: string | null;
  restricted_to_vip_tier_ids: number[];
  reward: { type: RewardType };
  reward_value: RewardValue;
  earning_limit: EarningLimit | null;
}

export interface ListEarningRulesOptions {
  limit?: number;
  cursor?: string;
}

export interface ListEarningRulesResponse {
  earning_rules: EarningRule[];
  metadata: PaginationMetadata;
}

// ============================================
// VIP Tiers
// ============================================

export interface VipTierPerk {
  name: string;
}

export interface VipTier {
  id: number;
  name: string;
  image_url: string;
  milestone: number;
  perks?: VipTierPerk[];
  entry_rewards?: unknown[];
}

export interface ListVipTiersOptions {
  /** Comma-separated nested objects: `perks` or `entry_rewards`. */
  include?: string;
}

export interface ListVipTiersResponse {
  vip_tiers: VipTier[];
}

// ============================================
// Points Settings
// ============================================

export interface PointsSettings {
  points_label: {
    one: string;
    other: string;
  };
}

export interface PointsSettingsResponse {
  points_settings: PointsSettings;
}

// ============================================
// Reward Fulfillments
// ============================================

export type FulfillmentStatus = 'pending' | 'issued' | 'cancelled' | 'failed';
export type UsageStatus = 'used' | 'unused' | 'untracked';

export interface RewardFulfillment {
  id: number;
  name: string;
  code: string | null;
  customer_id: number;
  fulfillment_status: FulfillmentStatus;
  image_url?: string | null;
  action_text?: string | null;
  action_url?: string | null;
  usage_instructions?: string | null;
  terms_and_conditions?: string | null;
  expires_at?: string | null;
  usage_status?: UsageStatus;
  used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListRewardFulfillmentsOptions extends CursorListOptions {
  customer_id?: number;
  fulfillment_status?: FulfillmentStatus;
  usage_status?: UsageStatus;
}

export interface ListRewardFulfillmentsResponse {
  reward_fulfillments: RewardFulfillment[];
  metadata: PaginationMetadata;
}

// ============================================
// API Error
// ============================================

export class SmileApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: unknown;

  constructor(message: string, statusCode: number, errors?: unknown) {
    super(message);
    this.name = 'SmileApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// Coinbase Connector Types
// Cryptocurrency accounts, prices, and transactions

// ============================================
// Configuration
// ============================================

export interface CoinbaseConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Money {
  amount: string;
  currency: string;
}

export interface Pagination {
  ending_before?: string;
  starting_after?: string;
  limit?: number;
  order?: 'desc' | 'asc';
  previous_uri?: string;
  next_uri?: string;
}

export interface PaginatedResponse<T> {
  pagination: Pagination;
  data: T[];
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  name?: string;
  username?: string;
  profile_location?: string;
  profile_bio?: string;
  profile_url?: string;
  avatar_url?: string;
  resource: 'user';
  resource_path: string;
  email?: string;
  legacy_id?: string;
  time_zone?: string;
  native_currency?: string;
  bitcoin_unit?: string;
  state?: string;
  country?: Country;
  nationality?: Country;
  region_supports_fiat_transfers?: boolean;
  region_supports_crypto_to_crypto_transfers?: boolean;
  created_at?: string;
  supports_rewards?: boolean;
  tiers?: UserTiers;
  referral_money?: Money;
  has_blocking_buy_restrictions?: boolean;
  has_made_a_purchase?: boolean;
  has_buy_deposit_payment_methods?: boolean;
  has_unverified_buy_deposit_payment_methods?: boolean;
  needs_kyc_remediation?: boolean;
  show_instant_ach_ux?: boolean;
  user_type?: string;
}

export interface Country {
  code: string;
  name: string;
  is_in_europe?: boolean;
}

export interface UserTiers {
  completed_description: string;
  upgrade_button_text?: string;
  header?: string;
  body?: string;
}

// ============================================
// Account Types
// ============================================

export interface Account {
  id: string;
  name: string;
  primary: boolean;
  type: 'wallet' | 'fiat' | 'vault';
  currency: Currency;
  balance: Money;
  created_at?: string;
  updated_at?: string;
  resource: 'account';
  resource_path: string;
  allow_deposits?: boolean;
  allow_withdrawals?: boolean;
}

export interface Currency {
  code: string;
  name: string;
  color: string;
  sort_index: number;
  exponent: number;
  type: 'crypto' | 'fiat';
  address_regex?: string;
  asset_id?: string;
  slug?: string;
}

export interface AccountResponse {
  data: Account;
}

export interface AccountsResponse extends PaginatedResponse<Account> {}

// ============================================
// Address Types
// ============================================

export interface Address {
  id: string;
  address: string;
  address_info?: AddressInfo;
  name?: string;
  created_at?: string;
  updated_at?: string;
  network: string;
  uri_scheme?: string;
  resource: 'address';
  resource_path: string;
  warnings?: Warning[];
  legacy_address?: string;
  destination_tag?: string;
  deposit_uri?: string;
  callback_url?: string;
}

export interface AddressInfo {
  address: string;
  destination_tag?: string;
}

export interface Warning {
  title: string;
  details: string;
  image_url?: string;
}

// ============================================
// Transaction Types
// ============================================

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Money;
  native_amount: Money;
  description?: string;
  created_at: string;
  updated_at: string;
  resource: 'transaction';
  resource_path: string;
  instant_exchange?: boolean;
  network?: TransactionNetwork;
  to?: TransactionParty;
  from?: TransactionParty;
  details?: TransactionDetails;
  hide_native_amount?: boolean;
}

export type TransactionType =
  | 'send'
  | 'request'
  | 'transfer'
  | 'buy'
  | 'sell'
  | 'fiat_deposit'
  | 'fiat_withdrawal'
  | 'exchange_deposit'
  | 'exchange_withdrawal'
  | 'vault_withdrawal'
  | 'advanced_trade_fill'
  | 'pro_deposit'
  | 'pro_withdrawal';

export type TransactionStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'canceled'
  | 'waiting_for_signature'
  | 'waiting_for_clearing';

export interface TransactionNetwork {
  status: string;
  status_description?: string;
  hash?: string;
  transaction_url?: string;
  transaction_fee?: Money;
  transaction_amount?: Money;
  confirmations?: number;
}

export interface TransactionParty {
  id?: string;
  resource: string;
  resource_path?: string;
  currency?: string;
  address?: string;
  address_info?: AddressInfo;
  email?: string;
}

export interface TransactionDetails {
  title: string;
  subtitle: string;
  header?: string;
  health?: string;
  payment_method_name?: string;
}

export interface SendMoneyRequest {
  type: 'send';
  to: string;
  amount: string;
  currency: string;
  description?: string;
  skip_notifications?: boolean;
  fee?: string;
  idem?: string;
  to_financial_institution?: boolean;
  financial_institution_website?: string;
}

// ============================================
// Price Types
// ============================================

export interface Price {
  amount: string;
  currency: string;
  base: string;
}

export interface SpotPrice {
  data: Price;
}

export interface BuyPrice {
  data: Price;
}

export interface SellPrice {
  data: Price;
}

// ============================================
// Exchange Rate Types
// ============================================

export interface ExchangeRates {
  currency: string;
  rates: Record<string, string>;
}

export interface ExchangeRatesResponse {
  data: ExchangeRates;
}

// ============================================
// Currency Types
// ============================================

export interface CurrencyInfo {
  id: string;
  name: string;
  min_size: string;
}

export interface CurrenciesResponse {
  data: CurrencyInfo[];
}

// ============================================
// Time Types
// ============================================

export interface ServerTime {
  iso: string;
  epoch: number;
}

export interface TimeResponse {
  data: ServerTime;
}

// ============================================
// API Error Types
// ============================================

export interface CoinbaseError {
  id: string;
  message: string;
  url?: string;
}

export class CoinbaseApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: CoinbaseError[];

  constructor(message: string, statusCode: number, errors?: CoinbaseError[]) {
    super(message);
    this.name = 'CoinbaseApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

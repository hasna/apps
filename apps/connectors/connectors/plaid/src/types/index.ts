// Plaid Connector Types

// ============================================
// Configuration
// ============================================

export interface PlaidConfig {
  clientId: string;
  secret: string;
  baseUrl?: string; // sandbox, development, or production
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type PlaidEnvironment = 'sandbox' | 'development' | 'production';

// ============================================
// Item Types
// ============================================

export interface Item {
  item_id: string;
  institution_id?: string;
  webhook?: string;
  error?: PlaidError;
  available_products: string[];
  billed_products: string[];
  consent_expiration_time?: string;
  update_type: 'background' | 'user_present_required';
}

export interface ItemGetResponse {
  item: Item;
  status?: ItemStatus;
  request_id: string;
}

export interface ItemStatus {
  investments?: ProductStatus;
  transactions?: ProductStatus;
  last_webhook?: WebhookStatus;
}

export interface ProductStatus {
  last_successful_update?: string;
  last_failed_update?: string;
}

export interface WebhookStatus {
  sent_at?: string;
  code_sent?: string;
}

// ============================================
// Account Types
// ============================================

export interface Account {
  account_id: string;
  balances: AccountBalance;
  mask?: string;
  name: string;
  official_name?: string;
  type: AccountType;
  subtype?: string;
  verification_status?: string;
}

export interface AccountBalance {
  available?: number;
  current?: number;
  limit?: number;
  iso_currency_code?: string;
  unofficial_currency_code?: string;
}

export type AccountType = 'investment' | 'credit' | 'depository' | 'loan' | 'brokerage' | 'other';

export interface AccountsGetResponse {
  accounts: Account[];
  item: Item;
  request_id: string;
}

// ============================================
// Transaction Types
// ============================================

export interface Transaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string;
  unofficial_currency_code?: string;
  category?: string[];
  category_id?: string;
  date: string;
  datetime?: string;
  authorized_date?: string;
  authorized_datetime?: string;
  location: TransactionLocation;
  name: string;
  merchant_name?: string;
  payment_meta: PaymentMeta;
  payment_channel: 'online' | 'in store' | 'other';
  pending: boolean;
  pending_transaction_id?: string;
  account_owner?: string;
  transaction_type?: string;
  transaction_code?: string;
  personal_finance_category?: PersonalFinanceCategory;
}

export interface TransactionLocation {
  address?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  lat?: number;
  lon?: number;
  store_number?: string;
}

export interface PaymentMeta {
  reference_number?: string;
  ppd_id?: string;
  payee?: string;
  by_order_of?: string;
  payer?: string;
  payment_method?: string;
  payment_processor?: string;
  reason?: string;
}

export interface PersonalFinanceCategory {
  primary: string;
  detailed: string;
}

export interface TransactionsGetResponse {
  accounts: Account[];
  transactions: Transaction[];
  total_transactions: number;
  item: Item;
  request_id: string;
}

export interface TransactionsSyncResponse {
  added: Transaction[];
  modified: Transaction[];
  removed: RemovedTransaction[];
  next_cursor: string;
  has_more: boolean;
  request_id: string;
}

export interface RemovedTransaction {
  transaction_id: string;
}

// ============================================
// Balance Types
// ============================================

export interface BalanceGetResponse {
  accounts: Account[];
  item: Item;
  request_id: string;
}

// ============================================
// Identity Types
// ============================================

export interface Identity {
  addresses: IdentityAddress[];
  emails: IdentityEmail[];
  names: string[];
  phone_numbers: IdentityPhoneNumber[];
}

export interface IdentityAddress {
  data: {
    city?: string;
    country?: string;
    postal_code?: string;
    region?: string;
    street?: string;
  };
  primary: boolean;
}

export interface IdentityEmail {
  data: string;
  primary: boolean;
  type: 'primary' | 'secondary' | 'other';
}

export interface IdentityPhoneNumber {
  data: string;
  primary: boolean;
  type: 'home' | 'work' | 'mobile' | 'other';
}

export interface AccountWithIdentity extends Account {
  owners: Identity[];
}

export interface IdentityGetResponse {
  accounts: AccountWithIdentity[];
  item: Item;
  request_id: string;
}

// ============================================
// Auth Types
// ============================================

export interface AuthNumbers {
  ach?: ACHNumbers[];
  eft?: EFTNumbers[];
  international?: InternationalNumbers[];
  bacs?: BACSNumbers[];
}

export interface ACHNumbers {
  account_id: string;
  account: string;
  routing: string;
  wire_routing?: string;
}

export interface EFTNumbers {
  account_id: string;
  account: string;
  institution: string;
  branch: string;
}

export interface InternationalNumbers {
  account_id: string;
  iban: string;
  bic: string;
}

export interface BACSNumbers {
  account_id: string;
  account: string;
  sort_code: string;
}

export interface AuthGetResponse {
  accounts: Account[];
  numbers: AuthNumbers;
  item: Item;
  request_id: string;
}

// ============================================
// Link Token Types
// ============================================

export interface LinkTokenCreateResponse {
  link_token: string;
  expiration: string;
  request_id: string;
}

export interface LinkTokenCreateOptions {
  client_name: string;
  language: string;
  country_codes: string[];
  user: {
    client_user_id: string;
    legal_name?: string;
    phone_number?: string;
    email_address?: string;
  };
  products?: string[];
  webhook?: string;
  access_token?: string;
  link_customization_name?: string;
  redirect_uri?: string;
  android_package_name?: string;
  account_filters?: Record<string, { account_subtypes: string[] }>;
}

// ============================================
// Institution Types
// ============================================

export interface Institution {
  institution_id: string;
  name: string;
  products: string[];
  country_codes: string[];
  url?: string;
  primary_color?: string;
  logo?: string;
  routing_numbers?: string[];
  oauth: boolean;
}

export interface InstitutionsGetResponse {
  institutions: Institution[];
  total: number;
  request_id: string;
}

export interface InstitutionGetResponse {
  institution: Institution;
  request_id: string;
}

// ============================================
// API Error Types
// ============================================

export interface PlaidError {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message?: string;
  request_id?: string;
  causes?: PlaidError[];
  status?: number;
  documentation_url?: string;
  suggested_action?: string;
}

export class PlaidApiError extends Error {
  public readonly statusCode: number;
  public readonly errorType?: string;
  public readonly errorCode?: string;

  constructor(message: string, statusCode: number, errorType?: string, errorCode?: string) {
    super(message);
    this.name = 'PlaidApiError';
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.errorCode = errorCode;
  }
}

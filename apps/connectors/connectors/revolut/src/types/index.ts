// Revolut Business API Types

// ============================================
// Configuration
// ============================================

export interface RevolutConfig {
  apiToken: string;
  sandbox?: boolean;
}

// ============================================
// Common Types
// ============================================

// OutputFormat is defined in utils/output.ts

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

// ============================================
// Account Types
// ============================================

export interface RevolutAccount {
  id: string;
  name: string;
  balance: number;
  currency: string;
  state: 'active' | 'inactive';
  public: boolean;
  created_at: string;
  updated_at: string;
}

export interface RevolutAccountBalance {
  currency: string;
  amount: number;
}

// ============================================
// Counterparty Types
// ============================================

export interface RevolutCounterparty {
  id: string;
  name: string;
  phone?: string;
  profile_type: 'personal' | 'business';
  country?: string;
  state: 'created' | 'deleted';
  created_at: string;
  updated_at: string;
  accounts?: RevolutCounterpartyAccount[];
}

export interface RevolutCounterpartyAccount {
  id: string;
  name?: string;
  bank_country?: string;
  currency: string;
  type: 'revolut' | 'external';
  account_no?: string;
  iban?: string;
  sort_code?: string;
  routing_number?: string;
  bic?: string;
  recipient_charges?: 'no' | 'expected';
}

export interface CreateCounterpartyRequest {
  profile_type: 'personal' | 'business';
  name: string;
  phone?: string;
  email?: string;
  // For Revolut counterparty
  revtag?: string;
  // For external bank account
  bank_country?: string;
  currency?: string;
  account_no?: string;
  iban?: string;
  sort_code?: string;
  routing_number?: string;
  bic?: string;
  address?: {
    street_line1?: string;
    street_line2?: string;
    region?: string;
    city?: string;
    country?: string;
    postcode?: string;
  };
}

// ============================================
// Payment/Transfer Types
// ============================================

export interface RevolutPayment {
  id: string;
  state: 'pending' | 'completed' | 'declined' | 'failed' | 'reverted' | 'created';
  reason_code?: string;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  request_id?: string;
  type: 'atm' | 'card_payment' | 'card_refund' | 'card_chargeback' | 'card_credit' | 'exchange' | 'transfer' | 'loan' | 'fee' | 'refund' | 'topup' | 'topup_return' | 'tax' | 'tax_refund';
  reference?: string;
  legs: RevolutPaymentLeg[];
  merchant?: {
    name?: string;
    city?: string;
    category_code?: string;
    country?: string;
  };
  card?: {
    card_number?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  };
}

export interface RevolutPaymentLeg {
  leg_id: string;
  account_id: string;
  counterparty?: {
    id?: string;
    account_id?: string;
    account_type?: string;
  };
  amount: number;
  fee?: number;
  currency: string;
  bill_amount?: number;
  bill_currency?: string;
  description?: string;
  balance?: number;
}

export interface CreatePaymentRequest {
  request_id: string;
  account_id: string;
  receiver: {
    counterparty_id: string;
    account_id?: string;
  };
  amount: number;
  currency: string;
  reference?: string;
  schedule_for?: string;
}

export interface CreateTransferRequest {
  request_id: string;
  source_account_id: string;
  target_account_id: string;
  amount: number;
  currency: string;
  reference?: string;
}

// ============================================
// Transaction Types
// ============================================

export interface RevolutTransaction {
  id: string;
  type: string;
  state: 'pending' | 'completed' | 'declined' | 'failed' | 'reverted' | 'created';
  request_id?: string;
  reason_code?: string;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  reference?: string;
  legs: RevolutPaymentLeg[];
  related_transaction_id?: string;
}

export interface TransactionListParams {
  from?: string;
  to?: string;
  count?: number;
  counterparty?: string;
  type?: string;
}

// ============================================
// Exchange Types
// ============================================

export interface RevolutExchangeRate {
  from: string;
  to: string;
  rate: number;
  fee?: number;
}

export interface ExchangeRequest {
  request_id: string;
  from: {
    account_id: string;
    currency: string;
    amount: number;
  };
  to: {
    account_id: string;
    currency: string;
  };
  reference?: string;
}

export interface RevolutExchangeResult {
  id: string;
  state: 'pending' | 'completed' | 'cancelled';
  created_at: string;
  completed_at?: string;
  client_order_id?: string;
  from: {
    account_id: string;
    currency: string;
    amount: number;
  };
  to: {
    account_id: string;
    currency: string;
    amount: number;
  };
  fee?: {
    currency: string;
    amount: number;
  };
}

// ============================================
// Card Types
// ============================================

export interface RevolutCard {
  id: string;
  label?: string;
  last_four_digits: string;
  expiry: string;
  state: 'active' | 'inactive' | 'frozen' | 'terminated';
  virtual: boolean;
  created_at: string;
  updated_at?: string;
  holder_id?: string;
  spending_limits?: RevolutSpendingLimit[];
  accounts?: string[];
  categories?: string[];
}

export interface RevolutSpendingLimit {
  limit_type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all_time' | 'per_transaction';
  limit_amount: number;
  limit_currency: string;
  categories?: string[];
}

export interface CreateCardRequest {
  holder_id?: string;
  label?: string;
  virtual?: boolean;
  accounts?: string[];
  spending_limits?: RevolutSpendingLimit[];
}

// ============================================
// Webhook Types
// ============================================

export interface RevolutWebhook {
  id: string;
  url: string;
  events: string[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class RevolutApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'RevolutApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}

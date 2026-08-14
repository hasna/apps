// Unit.sh API Types (JSON:API)

export type UnitEnvironment = 'sandbox' | 'production';

export interface UnitConfig {
  apiToken: string;
  environment?: UnitEnvironment;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryValue = string | number | boolean | undefined | string[] | number[];

export interface JsonApiResource<T extends string = string> {
  type: T;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface JsonApiDocument<T extends string = string> {
  data: JsonApiResource<T> | JsonApiResource<T>[];
  included?: JsonApiResource[];
  meta?: Record<string, unknown>;
}

export interface JsonApiError {
  status?: string;
  title?: string;
  detail?: string;
  code?: string;
}

export interface JsonApiErrorDocument {
  errors: JsonApiError[];
}

export interface PageParams {
  offset?: number;
  limit?: number;
}

export class UnitApiError extends Error {
  readonly status: number;
  readonly errors: JsonApiError[];

  constructor(message: string, status: number, errors: JsonApiError[] = []) {
    super(message);
    this.name = 'UnitApiError';
    this.status = status;
    this.errors = errors;
  }
}

// Account types
export type AccountStatus = 'Open' | 'Frozen' | 'Closed';

export interface ListAccountsParams extends PageParams {
  customerId?: string;
  status?: AccountStatus[];
  fromBalance?: number;
  toBalance?: number;
}

export interface CreateDepositAccountParams {
  customerId: string;
  depositProduct: string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

export interface CloseAccountParams {
  reason?: 'ByCustomer' | 'Fraud';
  reasonText?: string;
}

// Application types
export interface ListApplicationsParams extends PageParams {
  email?: string;
  query?: string;
  status?: string[];
}

// Customer types
export type CustomerStatus = 'Active' | 'Archived';

export interface ListCustomersParams extends PageParams {
  status?: CustomerStatus[];
  query?: string;
  email?: string;
}

// Card types
export interface ListCardsParams extends PageParams {
  accountId?: string;
  customerId?: string;
  status?: string[];
  type?: string;
}

export type DebitCardType =
  | 'individualDebitCard'
  | 'businessDebitCard'
  | 'individualVirtualDebitCard'
  | 'businessVirtualDebitCard';

export interface CreateDebitCardParams {
  type: DebitCardType;
  accountId: string;
  shippingAddress?: Record<string, unknown>;
  designId?: string;
  fullName?: { first: string; last: string };
  dateOfBirth?: string;
  address?: Record<string, unknown>;
  phone?: Record<string, unknown>;
  email?: string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

// Transaction types
export interface ListTransactionsParams extends PageParams {
  accountId?: string;
  customerId?: string;
  type?: string[];
  since?: string;
  until?: string;
  cardId?: string;
  excludeFees?: boolean;
}

// Payment types
export type PaymentDirection = 'Debit' | 'Credit';

export interface CreateAchPaymentParams {
  direction: PaymentDirection;
  amount: number;
  description: string;
  accountId: string;
  counterpartyId?: string;
  counterparty?: Record<string, unknown>;
  addenda?: string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

export interface CreateBookPaymentParams {
  amount: number;
  description: string;
  accountId: string;
  counterpartyAccountId: string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

export interface ListPaymentsParams extends PageParams {
  accountId?: string;
  customerId?: string;
  status?: string[];
  direction?: PaymentDirection;
  type?: string[];
}

// Counterparty types
export interface ListCounterpartiesParams extends PageParams {
  customerId?: string;
  permissions?: string[];
  routingNumber?: string;
}

export interface CreateCounterpartyParams {
  name: string;
  routingNumber: string;
  accountNumber: string;
  accountType: 'Checking' | 'Savings';
  type: 'Business' | 'Person' | 'Unknown';
  permissions?: 'CreditOnly' | 'DebitOnly' | 'CreditAndDebit';
  customerId: string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

// Webhook types
export interface ListWebhooksParams extends PageParams {
  type?: 'Live' | 'Simulation';
}

export interface CreateWebhookParams {
  label: string;
  url: string;
  token: string;
  subscriptionType?: 'PartnerEvents' | 'PaymentEvents';
  deliveryMode?: 'AtMostOnce' | 'AtLeastOnce';
  contentType?: 'Json' | 'JsonAPI';
}

// Event types
export interface ListEventsParams extends PageParams {
  type?: string[];
  since?: string;
  until?: string;
}

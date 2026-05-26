// Mercury API Types
// Banking API for business accounts

// ============================================
// Configuration
// ============================================

export interface MercuryConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  hasMore: boolean;
}

// Currency amount in cents
export type CurrencyAmount = number;

// ISO 8601 date string
export type DateString = string;

// ============================================
// Account Types
// ============================================

export type AccountType = 'checking' | 'savings' | 'mercury_treasury';

export type AccountStatus = 'active' | 'pending' | 'closed';

export interface Account {
  id: string;
  name: string;
  nickname?: string;
  type: AccountType;
  status: AccountStatus;
  routingNumber: string;
  accountNumber: string;
  currentBalance: CurrencyAmount;
  availableBalance: CurrencyAmount;
  kind: 'personal' | 'business';
  canReceiveTransactions: boolean;
  createdAt: DateString;
}

export interface AccountListParams {
  limit?: number;
  offset?: number;
}

export interface AccountListResponse {
  accounts: Account[];
  total: number;
}

export interface AccountStatement {
  id: string;
  accountId: string;
  month: number;
  year: number;
  startDate: DateString;
  endDate: DateString;
  downloadUrl?: string;
}

export type CardStatus = 'active' | 'frozen' | 'cancelled' | 'inactive' | 'expired' | 'suspended';
export type CardNetwork = 'visa' | 'mastercard';
export type PhysicalCardStatus = 'inactive' | 'active' | 'paused';

export interface AccountCard {
  cardId: string;
  nameOnCard: string;
  lastFourDigits: string;
  network: CardNetwork;
  status: CardStatus;
  createdAt: DateString;
  physicalCardStatus?: PhysicalCardStatus | null;
}

// ============================================
// Transaction Types
// ============================================

export type TransactionStatus =
  | 'pending'
  | 'sent'
  | 'cancelled'
  | 'failed';

export type TransactionKind =
  | 'externalTransfer'
  | 'internalTransfer'
  | 'outgoingPayment'
  | 'debitCardTransaction'
  | 'creditCardTransaction'
  | 'incomingDomesticWire'
  | 'outgoingDomesticWire'
  | 'incomingInternationalWire'
  | 'outgoingInternationalWire'
  | 'checkDeposit'
  | 'fee'
  | 'interest'
  | 'other';

export interface Transaction {
  id: string;
  accountId: string;
  amount: CurrencyAmount;
  counterpartyId?: string;
  counterpartyName?: string;
  counterpartyNickname?: string;
  createdAt: DateString;
  postedAt?: DateString;
  estimatedDeliveryDate?: DateString;
  dashboardLink: string;
  details?: Record<string, unknown>;
  externalMemo?: string;
  failedAt?: DateString;
  kind: TransactionKind;
  note?: string;
  reasonForFailure?: string;
  status: TransactionStatus;
  bankDescription?: string;
  feeId?: string;
  attachments?: TransactionAttachment[];
}

export interface TransactionAttachment {
  id: string;
  fileName: string;
  fileType: string;
  downloadUrl: string;
}

export interface TransactionListParams {
  limit?: number;
  offset?: number;
  status?: TransactionStatus;
  start?: DateString;
  end?: DateString;
  search?: string;
}

export interface TransactionListResponse {
  transactions: Transaction[];
  total: number;
}

// ============================================
// Recipient Types
// ============================================

export type RecipientPaymentMethod =
  | 'ach'
  | 'domesticWire'
  | 'internationalWire'
  | 'check';

export interface RecipientAddress {
  address1: string;
  address2?: string;
  city: string;
  region: string;  // State/Province
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
}

export interface RoutingInfo {
  routingNumber: string;
  accountNumber: string;
  bankName?: string;
  address?: RecipientAddress;
}

export interface InternationalRoutingInfo {
  swiftCode?: string;
  iban?: string;
  bankName?: string;
  accountNumber?: string;
  address?: RecipientAddress;
}

export interface Recipient {
  id: string;
  name: string;
  nickname?: string;
  emails: string[];
  contactEmail?: string;
  isBusiness: boolean;
  defaultPaymentMethod?: RecipientPaymentMethod;
  defaultAddress?: RecipientAddress;
  electronicRoutingInfo?: RoutingInfo;
  domesticWireRoutingInfo?: RoutingInfo;
  internationalWireRoutingInfo?: InternationalRoutingInfo;
  checkInfo?: RecipientAddress;
  status: 'active' | 'deleted';
  dateLastPaid?: DateString;
  attachments?: Array<{
    fileName: string;
    url: string;
    uploadedAt: DateString;
  }>;
}

export interface RecipientCreateParams {
  name: string;
  nickname?: string;
  emails?: string[];
  isBusiness?: boolean;
  defaultPaymentMethod: RecipientPaymentMethod;
  defaultAddress?: RecipientAddress;
  electronicRoutingInfo?: RoutingInfo;
  domesticWireRoutingInfo?: RoutingInfo;
  internationalWireRoutingInfo?: InternationalRoutingInfo;
  checkInfo?: RecipientAddress;
}

export interface RecipientUpdateParams {
  name?: string;
  nickname?: string;
  emails?: string[];
  defaultAddress?: RecipientAddress;
}

export interface RecipientListResponse {
  recipients: Recipient[];
  total: number;
}

// ============================================
// Transfer Types
// ============================================

export type TransferStatus =
  | 'pending'
  | 'sent'
  | 'cancelled'
  | 'failed';

export interface Transfer {
  id: string;
  accountId: string;
  recipientId: string;
  amount: CurrencyAmount;
  status: TransferStatus;
  paymentMethod: RecipientPaymentMethod;
  idempotencyKey?: string;
  externalMemo?: string;
  note?: string;
  estimatedDeliveryDate?: DateString;
  createdAt: DateString;
  sentAt?: DateString;
  failedAt?: DateString;
  reasonForFailure?: string;
}

export interface TransferCreateParams {
  accountId: string;
  recipientId: string;
  amount: CurrencyAmount;
  paymentMethod?: RecipientPaymentMethod;
  idempotencyKey?: string;
  externalMemo?: string;
  note?: string;
}

export interface TransferListParams {
  limit?: number;
  offset?: number;
  status?: TransferStatus;
  accountId?: string;
  recipientId?: string;
}

export interface TransferListResponse {
  transfers: Transfer[];
  total: number;
}

// ============================================
// Invoice Types
// ============================================

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'void';

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: CurrencyAmount;
  amount: CurrencyAmount;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: CurrencyAmount;
  tax?: CurrencyAmount;
  total: CurrencyAmount;
  amountDue: CurrencyAmount;
  amountPaid: CurrencyAmount;
  dueDate: DateString;
  issueDate: DateString;
  lineItems: InvoiceLineItem[];
  memo?: string;
  termsAndConditions?: string;
  invoiceUrl?: string;
  createdAt: DateString;
  updatedAt: DateString;
  paidAt?: DateString;
}

export interface InvoiceCreateParams {
  customerId: string;
  dueDate: DateString;
  lineItems: Omit<InvoiceLineItem, 'amount'>[];
  memo?: string;
  termsAndConditions?: string;
  currency?: string;
  tax?: CurrencyAmount;
}

export interface InvoiceListParams {
  limit?: number;
  offset?: number;
  status?: InvoiceStatus;
  customerId?: string;
}

export interface InvoiceListResponse {
  invoices: Invoice[];
  total: number;
}

// ============================================
// Customer Types
// ============================================

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address?: RecipientAddress;
  notes?: string;
  createdAt: DateString;
  updatedAt: DateString;
}

export interface CustomerCreateParams {
  name: string;
  email: string;
  phone?: string;
  address?: RecipientAddress;
  notes?: string;
}

export interface CustomerListResponse {
  customers: Customer[];
  total: number;
}

// ============================================
// Treasury Types
// ============================================

export interface TreasuryAccount {
  id: string;
  accountId: string;  // Parent checking account
  name: string;
  currentBalance: CurrencyAmount;
  apy: number;  // Annual percentage yield
  status: 'active' | 'pending' | 'closed';
  createdAt: DateString;
}

export interface TreasuryTransaction {
  id: string;
  treasuryAccountId: string;
  type: 'deposit' | 'withdrawal' | 'interest';
  amount: CurrencyAmount;
  status: TransactionStatus;
  createdAt: DateString;
  completedAt?: DateString;
}

export interface TreasuryListResponse {
  accounts: TreasuryAccount[];
}

// ============================================
// Organization & User Types
// ============================================

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  ein?: string;
  website?: string;
  address?: RecipientAddress;
  createdAt: DateString;
}

export type UserRole = 'admin' | 'member' | 'accountant' | 'viewer';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: 'active' | 'pending' | 'deactivated';
  lastLoginAt?: DateString;
  createdAt: DateString;
}

export interface UserListResponse {
  users: User[];
  total: number;
}

// ============================================
// Webhook Types
// ============================================

export type WebhookEventType =
  | 'transaction.created'
  | 'transaction.updated'
  | 'checkingAccount.balance.updated'
  | 'savingsAccount.balance.updated'
  | 'treasuryAccount.balance.updated'
  | 'investmentAccount.balance.updated'
  | 'creditAccount.balance.updated';

// Keep legacy type for backwards compatibility
export type WebhookEvent = WebhookEventType;

export interface Webhook {
  id: string;
  url: string;
  eventTypes?: WebhookEventType[];
  filterPaths?: string[];
  status: 'active' | 'disabled';
  secret: string;
  createdAt: DateString;
  updatedAt: DateString;
}

export interface WebhookCreateParams {
  url: string;
  eventTypes?: WebhookEventType[];
  filterPaths?: string[];
}

export interface WebhookListResponse {
  webhooks: Webhook[];
  total: number;
}

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
  createdAt: DateString;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class MercuryApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'MercuryApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

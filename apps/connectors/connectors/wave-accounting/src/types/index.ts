// Wave Accounting Connector Types
// GraphQL API for businesses, invoices, customers, and accounts

export interface WaveAccountingConfig {
  accessToken: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface GraphQLResponse<T> {
  data?: T;
  errors?: WaveGraphQLError[];
}

export interface WaveGraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
  extensions?: Record<string, unknown>;
}

export class WaveApiError extends Error {
  readonly statusCode?: number;
  readonly errors?: WaveGraphQLError[];

  constructor(message: string, statusCode?: number, errors?: WaveGraphQLError[]) {
    super(message);
    this.name = 'WaveApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
  businessId?: string;
}

export interface Money {
  raw: number;
  value: string;
}

export interface Currency {
  code: string;
  name?: string;
  symbol?: string;
}

export interface Business {
  id: string;
  name: string;
  isPersonal: boolean;
  isArchived: boolean;
  createdAt: string;
  modifiedAt: string;
  currency?: Currency;
  timezone?: string;
  website?: string;
}

export interface BusinessConnection {
  edges: Array<{ node: Business }>;
  pageInfo: OffsetPageInfo;
}

export interface OffsetPageInfo {
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  displayId?: string;
  isArchived?: boolean;
  createdAt: string;
  modifiedAt: string;
}

export interface CustomerConnection {
  edges: Array<{ node: Customer }>;
  pageInfo: OffsetPageInfo;
}

export type InvoiceStatus =
  | 'DRAFT'
  | 'SAVED'
  | 'SENT'
  | 'VIEWED'
  | 'OVERDUE'
  | 'PARTIAL'
  | 'PAID'
  | 'OVERPAID';

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  title: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  createdAt: string;
  modifiedAt: string;
  pdfUrl?: string;
  viewUrl?: string;
  amountDue?: Money;
  amountPaid?: Money;
  total?: Money;
  customer?: Customer;
  currency?: Currency;
}

export interface InvoiceConnection {
  edges: Array<{ node: Invoice }>;
  pageInfo: OffsetPageInfo;
}

export interface Account {
  id: string;
  name: string;
  description?: string;
  isArchived?: boolean;
  subtype?: { name: string; value: string };
  type?: { name: string; value: string };
}

export interface AccountConnection {
  edges: Array<{ node: Account }>;
  pageInfo: OffsetPageInfo;
}

export interface InputError {
  path?: string[];
  message: string;
  code?: string;
}

export interface InvoiceCreateInput {
  businessId: string;
  customerId: string;
  status?: 'DRAFT' | 'SAVED';
  title?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  memo?: string;
  items?: InvoiceCreateItemInput[];
}

export interface InvoiceCreateItemInput {
  productId: string;
  description?: string;
  quantity?: string;
  unitPrice?: string;
}

export interface InvoiceCreateOutput {
  invoiceCreate: {
    invoice?: Invoice;
    didSucceed: boolean;
    inputErrors?: InputError[];
  };
}

export interface ListInvoicesOptions {
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  customerId?: string;
}

export interface ListCustomersOptions {
  page?: number;
  pageSize?: number;
  email?: string;
}

export interface ListAccountsOptions {
  page?: number;
  pageSize?: number;
  isArchived?: boolean;
}

export interface ListBusinessesOptions {
  page?: number;
  pageSize?: number;
  isArchived?: boolean;
}

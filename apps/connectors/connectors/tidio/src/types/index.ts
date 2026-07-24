// Tidio Connector Types

export interface TidioConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type TicketStatus = 'open' | 'pending' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type LyroDataSourceKind = 'folder' | 'qa';

export interface PaginatedMeta {
  cursor?: string;
  limit?: number;
  total?: number;
}

export interface PaginatedResponse<T> {
  resources?: T[];
  meta?: PaginatedMeta;
  [key: string]: unknown;
}

export interface Contact {
  id: string;
  email?: string;
  phone?: string;
  first_name?: string | null;
  last_name?: string | null;
  distinct_id?: string;
  properties?: ContactProperty[];
  email_consent?: 'subscribed' | 'unsubscribed' | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ContactProperty {
  name: string;
  value: string | number | boolean | null;
}

export interface ContactMessage {
  id: string;
  contact_id?: string;
  message?: string;
  author?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface MessageAccepted {
  status?: string;
  [key: string]: unknown;
}

export interface UuidResponse {
  id: string;
}

export interface Operator {
  id: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface Department {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface TicketTag {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface TicketCustomField {
  id: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

export interface Ticket {
  id: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  subject?: string;
  contact_id?: string;
  assignee_id?: string | null;
  department_id?: string | null;
  messages?: unknown[];
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Product {
  id: number;
  title: string;
  url: string;
  image_url?: string;
  description?: string;
  price?: number;
  default_currency?: string;
  vendor?: string;
  product_type?: string;
  sku?: string;
  barcode?: string;
  availability?: string;
  updated_at: string;
  features?: Record<string, string>;
  [key: string]: unknown;
}

export interface LyroDataSource {
  id: string;
  kind?: LyroDataSourceKind;
  type?: string;
  title?: string;
  content?: string | null;
  source_url?: string | null;
  parent_id?: string | null;
  [key: string]: unknown;
}

export interface Project {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ListContactsParams {
  limit?: number;
  cursor?: string;
  updatedAfter?: string;
  updatedBefore?: string;
}

export interface CreateContactParams {
  email?: string;
  phone?: string;
  firstName?: string | null;
  lastName?: string | null;
  distinctId?: string;
  properties?: ContactProperty[];
  emailConsent?: 'subscribed' | 'unsubscribed' | null;
}

export interface UpdateContactParams {
  email?: string;
  phone?: string;
  firstName?: string | null;
  lastName?: string | null;
  distinctId?: string;
  properties?: ContactProperty[];
  emailConsent?: 'subscribed' | 'unsubscribed' | null;
}

export interface BatchContactsParams<T extends CreateContactParams | UpdateContactParams> {
  contacts: T[];
}

export interface ListContactMessagesParams {
  cursor?: string;
}

export interface SendContactMessageParams {
  message: string;
}

export interface ListTicketsParams {
  limit?: number;
  cursor?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
}

export interface CreateTicketAsContactParams {
  contactId: string;
  message: string;
  subject?: string;
  priority?: TicketPriority;
}

export interface UpdateTicketParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  departmentId?: string | null;
}

export interface ReplyTicketParams {
  message: string;
  authorType?: 'operator' | 'contact';
}

export interface ListLyroDataSourcesParams {
  cursor?: string;
  limit?: number;
  kind?: LyroDataSourceKind;
  parentId?: string | null;
}

export interface CreateLyroQaDataSourceParams {
  question: string;
  answer: string;
  parentId?: string | null;
}

export interface UpsertLyroWebsiteDataSourceParams {
  url: string;
  title?: string;
  content: string;
}

export interface ScrapeLyroWebsiteParams {
  url: string;
}

export interface LyroTicketMessage {
  created_at: string;
  message_id: string;
  author_type: 'contact';
  message_type: 'public';
  message_content: string;
  attachments?: string[];
}

export interface AskLyroTicketParams {
  ticketId: string;
  subject: string;
  contactEmail: string;
  contactName: string;
  recipientEmail: string;
  messages: LyroTicketMessage[];
}

export interface TidioErrorResponse {
  message?: string;
  error?: string;
  errors?: Array<{ code?: string; message?: string }>;
  [key: string]: unknown;
}

export class TidioApiError extends Error {
  public readonly statusCode: number;
  public readonly response?: TidioErrorResponse;

  constructor(message: string, statusCode: number, response?: TidioErrorResponse) {
    super(message);
    this.name = 'TidioApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

export function parseTidioError(data: unknown, statusCode: number): TidioApiError {
  const record = data && typeof data === 'object' ? (data as TidioErrorResponse) : {};
  const nestedMessage = Array.isArray(record.errors) ? record.errors[0]?.message : undefined;
  const message = nestedMessage ?? record.message ?? record.error ?? `Request failed (${statusCode})`;
  return new TidioApiError(String(message), statusCode, record);
}

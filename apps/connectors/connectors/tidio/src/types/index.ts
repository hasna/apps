// Tidio Connector Types

export interface TidioConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type ConversationStatus = 'open' | 'closed' | 'snoozed';
export type MessageType = 'text' | 'image' | 'file' | 'note';
export type WebhookEvent =
  | 'contact.created'
  | 'contact.updated'
  | 'conversation.created'
  | 'conversation.updated'
  | 'message.created';

export interface PaginatedMeta {
  cursor?: string;
  limit?: number;
  total?: number;
}

export interface PaginatedResponse<T> {
  data?: T[];
  meta?: PaginatedMeta;
  [key: string]: unknown;
}

export interface Contact {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  external_id?: string;
  tags?: string[];
  properties?: Record<string, unknown>;
  subscriber?: boolean;
  consent?: boolean;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Conversation {
  id: string;
  status?: ConversationStatus;
  channel?: string;
  contact_id?: string;
  operator_id?: string;
  department_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  type?: MessageType;
  content?: string;
  media_url?: string;
  private?: boolean;
  operator_id?: string;
  created_at?: string;
  [key: string]: unknown;
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

export interface Tag {
  id: string;
  name: string;
  color?: string;
  [key: string]: unknown;
}

export interface Automation {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface CannedResponse {
  id: string;
  shortcut: string;
  content: string;
  department_id?: string;
  [key: string]: unknown;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
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
  name?: string;
  externalId?: string;
  tags?: string[];
  properties?: Record<string, unknown>;
  subscriber?: boolean;
  consent?: boolean;
}

export interface UpdateContactParams {
  email?: string;
  phone?: string;
  name?: string;
  externalId?: string;
  tags?: string[];
  properties?: Record<string, unknown>;
  subscriber?: boolean;
  consent?: boolean;
}

export interface ListConversationsParams {
  limit?: number;
  cursor?: string;
  status?: ConversationStatus;
  channel?: string;
  updatedAfter?: string;
}

export interface ListMessagesParams {
  limit?: number;
  cursor?: string;
}

export interface SendMessageParams {
  type: MessageType;
  content: string;
  mediaUrl?: string;
  private?: boolean;
  operatorId?: string;
}

export interface SetConversationStatusParams {
  status: ConversationStatus;
  snoozedUntil?: string;
}

export interface AssignConversationParams {
  operatorId: string | null;
  departmentId?: string;
}

export interface CreateTagParams {
  name: string;
  color?: string;
}

export interface CreateCannedResponseParams {
  shortcut: string;
  content: string;
  departmentId?: string;
}

export interface CreateWebhookParams {
  url: string;
  events: WebhookEvent[];
  secret?: string;
}

export interface TidioErrorResponse {
  message?: string;
  error?: string;
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
  const message = record.message ?? record.error ?? `Request failed (${statusCode})`;
  return new TidioApiError(String(message), statusCode, record);
}

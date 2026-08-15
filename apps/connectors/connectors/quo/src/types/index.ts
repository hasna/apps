// Quo (OpenPhone) API Types

// ============================================
// Configuration
// ============================================

export interface QuoConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  totalItems?: number;
  nextPageToken?: string;
}

// ============================================
// Message Types
// ============================================

export type MessageDirection = 'incoming' | 'outgoing';
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'received';

export interface Message {
  id: string;
  to: string[];
  from: string;
  text: string;
  phoneNumberId: string;
  direction: MessageDirection;
  userId: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MessageListResponse {
  data: Message[];
  totalItems?: number;
  nextPageToken?: string;
}

export interface SendMessageParams {
  from: string;
  to: string[];
  text: string;
}

// ============================================
// Contact Types
// ============================================

export interface ContactPhoneNumber {
  name?: string;
  value: string;
  id?: string;
}

export interface ContactEmail {
  name?: string;
  value: string;
  id?: string;
}

export interface ContactDefaultFields {
  company?: string;
  emails?: ContactEmail[];
  firstName?: string;
  lastName?: string;
  phoneNumbers?: ContactPhoneNumber[];
  role?: string;
}

export interface ContactCustomField {
  name: string;
  type: string;
  value: string | string[];
  key?: string;
  id?: string;
}

export interface Contact {
  id: string;
  externalId?: string;
  source?: string;
  sourceUrl?: string;
  defaultFields: ContactDefaultFields;
  customFields?: ContactCustomField[];
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
}

export interface ContactListResponse {
  data: Contact[];
  totalItems?: number;
  nextPageToken?: string;
}

export interface CreateContactParams {
  defaultFields: ContactDefaultFields;
  customFields?: Record<string, string | string[]>;
}

export interface UpdateContactParams {
  defaultFields?: Partial<ContactDefaultFields>;
  customFields?: Record<string, string | string[]>;
}

// ============================================
// Conversation Types
// ============================================

export interface Conversation {
  id: string;
  name?: string;
  participants: string[];
  phoneNumberId: string;
  assignedTo?: string;
  lastActivityAt?: string;
  lastActivityId?: string;
  mutedUntil?: string;
  snoozedUntil?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ConversationListResponse {
  data: Conversation[];
  totalItems?: number;
  nextPageToken?: string;
}

// ============================================
// Call Types
// ============================================

export type CallDirection = 'incoming' | 'outgoing';
export type CallStatus = 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled';
export type CallRoute = 'phone-number' | 'user' | 'external';
export type AiHandled = 'ai-agent' | 'none';

export interface Call {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  phoneNumberId: string;
  userId?: string;
  participants: string[];
  duration?: number;
  answeredAt?: string;
  answeredBy?: string;
  initiatedBy?: string;
  completedAt?: string;
  callRoute?: CallRoute;
  forwardedFrom?: string;
  forwardedTo?: string;
  aiHandled?: AiHandled;
  createdAt: string;
  updatedAt: string;
}

export interface CallListResponse {
  data: Call[];
  totalItems?: number;
  nextPageToken?: string;
}

export interface CallRecording {
  id: string;
  callId: string;
  url: string;
  duration: number;
  createdAt: string;
}

export interface CallSummary {
  id: string;
  callId: string;
  summary: string;
  createdAt: string;
}

export interface CallTranscription {
  id: string;
  callId: string;
  transcription: string;
  createdAt: string;
}

export interface Voicemail {
  id: string;
  callId: string;
  url: string;
  transcription?: string;
  duration: number;
  createdAt: string;
}

// ============================================
// Phone Number Types
// ============================================

export type PortingStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

export interface PhoneNumberUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  groupId?: string;
}

export interface PhoneNumberRestrictions {
  calling: {
    US: string;
    CA: string;
    Intl: string;
  };
  messaging: {
    US: string;
    CA: string;
    Intl: string;
  };
}

export interface PhoneNumber {
  id: string;
  groupId?: string;
  portRequestId?: string;
  formattedNumber: string;
  number: string;
  name?: string;
  forward?: string;
  symbol?: string;
  portingStatus?: PortingStatus;
  users?: PhoneNumberUser[];
  restrictions?: PhoneNumberRestrictions;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneNumberListResponse {
  data: PhoneNumber[];
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  groupId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserListResponse {
  data: User[];
}

// ============================================
// Webhook Types
// ============================================

export type WebhookStatus = 'enabled' | 'disabled';

export type MessageWebhookEvent = 'message.received' | 'message.sent' | 'message.delivered' | 'message.failed';
export type CallWebhookEvent = 'call.completed' | 'call.ringing' | 'call.recording.completed';
export type CallSummaryWebhookEvent = 'call.summary.completed';
export type CallTranscriptWebhookEvent = 'call.transcript.completed';

export type WebhookEvent = MessageWebhookEvent | CallWebhookEvent | CallSummaryWebhookEvent | CallTranscriptWebhookEvent;

export interface Webhook {
  id: string;
  userId?: string;
  orgId?: string;
  label?: string;
  status: WebhookStatus;
  url: string;
  key?: string;
  events: WebhookEvent[];
  resourceIds?: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface WebhookListResponse {
  data: Webhook[];
}

export interface CreateWebhookParams {
  url: string;
  events: WebhookEvent[];
  label?: string;
  status?: WebhookStatus;
  resourceIds?: string[];
  userId?: string;
}

// ============================================
// Custom Field Types
// ============================================

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'multi-select' | 'url' | 'email' | 'phone-number';

export interface CustomFieldOption {
  id: string;
  value: string;
}

export interface CustomField {
  id: string;
  key: string;
  name: string;
  type: CustomFieldType;
  options?: CustomFieldOption[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldListResponse {
  data: CustomField[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class QuoApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'QuoApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

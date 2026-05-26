// Gmail API Connector Types

// ============================================
// Configuration
// ============================================

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
  tokens?: OAuth2Tokens;
  userEmail?: string;
  userName?: string; // Display name for sending emails
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Gmail Message Types
// ============================================

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload?: MessagePart;
  sizeEstimate: number;
  raw?: string;
}

export interface MessagePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: MessageHeader[];
  body: MessagePartBody;
  parts?: MessagePart[];
}

export interface MessageHeader {
  name: string;
  value: string;
}

export interface MessagePartBody {
  attachmentId?: string;
  size: number;
  data?: string;
}

export interface MessageListResponse {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

// ============================================
// Gmail Label Types
// ============================================

export interface GmailLabel {
  id: string;
  name: string;
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: LabelColor;
}

export interface LabelColor {
  textColor: string;
  backgroundColor: string;
}

// ============================================
// Gmail Thread Types
// ============================================

export interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
  snippet?: string;
}

export interface ThreadListResponse {
  threads: Array<{ id: string; snippet: string; historyId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

// ============================================
// Gmail Draft Types
// ============================================

export interface GmailDraft {
  id: string;
  message: GmailMessage;
}

// ============================================
// Send Message Types
// ============================================

export interface SendMessageOptions {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  threadId?: string;
  attachments?: Attachment[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  data: string; // base64 encoded
}

// ============================================
// Search/Query Types
// ============================================

export interface ListMessagesOptions {
  maxResults?: number;
  pageToken?: string;
  q?: string; // Gmail search query
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

export interface ListThreadsOptions {
  maxResults?: number;
  pageToken?: string;
  q?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

// ============================================
// Profile Types
// ============================================

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

// ============================================
// API Error Types
// ============================================

export interface GmailError {
  code: number;
  message: string;
  errors?: Array<{
    domain: string;
    reason: string;
    message: string;
  }>;
}

export class GmailApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: GmailError['errors'];

  constructor(message: string, statusCode: number, errors?: GmailError['errors']) {
    super(message);
    this.name = 'GmailApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

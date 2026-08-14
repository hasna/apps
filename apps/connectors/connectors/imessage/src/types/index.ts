// iMessage Connector Types

// ============================================
// Configuration
// ============================================

export interface IMessageConfig {
  bridgeUrl: string;
  apiKey?: string;
  deviceId?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Health Types
// ============================================

export interface IMessageHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  bridge: {
    reachable: boolean;
    version?: string;
    platform?: string;
    lastSeen?: string;
  };
  imessage: {
    signedIn: boolean;
    account?: string;
  };
  timestamp: string;
}

// ============================================
// Conversation Types
// ============================================

export interface IMessageConversation {
  id: string;
  chatIdentifier: string;
  displayName: string;
  type: 'single' | 'group';
  participants: IMessageParticipant[];
  lastMessage?: IMessagePreview;
  unreadCount?: number;
  createdDate?: string;
  lastMessageDate?: string;
}

export interface IMessageParticipant {
  handle: string;
  name?: string;
  isMe: boolean;
}

export interface IMessagePreview {
  text: string;
  fromMe: boolean;
  date: string;
}

// ============================================
// Message Types
// ============================================

export interface IMessage {
  guid: string;
  chatGuid: string;
  text?: string;
  attachments?: IMessageAttachment[];
  fromMe: boolean;
  handle?: string;
  displayName?: string;
  date: string;
  dateRead?: string;
  dateDelivered?: string;
  error?: number;
  isForward: boolean;
  subject?: string;
  threadOriginatorGuid?: string;
}

export interface IMessageAttachment {
  guid: string;
  mimeType: string;
  fileName?: string;
  transferState?: string;
  totalBytes?: number;
  transferredBytes?: number;
}

// ============================================
// Contact Types
// ============================================

export interface IMessageContact {
  handle: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phoneNumbers?: string[];
  emails?: string[];
}

// ============================================
// API Response Types
// ============================================

export interface IMessageApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: number;
}

// ============================================
// API Error Types
// ============================================

export class IMessageApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: number;

  constructor(message: string, statusCode: number, errorCode?: number) {
    super(message);
    this.name = 'IMessageApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

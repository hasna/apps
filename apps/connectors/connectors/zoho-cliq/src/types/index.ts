export type OutputFormat = 'json' | 'table' | 'pretty';

export type ZohoCliqDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export type ZohoCliqUserStatus = 'available' | 'busy' | 'invisible' | 'offline';

export type ZohoCliqChannelType =
  | 'private'
  | 'team'
  | 'personal'
  | 'external'
  | 'organization';

export type ZohoCliqChatType = 'channel' | 'directchat' | 'groupchat';

export interface ZohoCliqConfig {
  token: string;
  dataCenter?: ZohoCliqDataCenter | string;
  baseUrl?: string;
}

export interface CliConfig {
  token?: string;
  dataCenter?: string;
}

export interface ZohoCliqUser {
  id: string;
  name?: string;
  email_id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ZohoCliqChannel {
  channel_id?: string;
  name?: string;
  description?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ZohoCliqChat {
  chat_id?: string;
  title?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ZohoCliqMessage {
  id?: string;
  text?: string;
  sender?: { id?: string; name?: string };
  [key: string]: unknown;
}

export interface ZohoCliqBot {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ZohoCliqDepartment {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface MessageCardOptions {
  text: string;
  bot?: { name?: string; image?: string };
  card?: Record<string, unknown>;
  slides?: Array<Record<string, unknown>>;
  buttons?: Array<Record<string, unknown>>;
}

export class ZohoCliqApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ZohoCliqApiError';
  }
}

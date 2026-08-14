// TimelinesAI connector types (from public OpenAPI spec)

export interface TimelinesAIConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export class TimelinesAIApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'TimelinesAIApiError';
  }
}

export interface ApiStatusResponse<T> {
  status: 'ok' | 'error';
  data: T;
}

export interface ChatInfo {
  id: number;
  name: string;
  phone?: string | null;
  jid: string;
  is_group: boolean;
  closed: boolean;
  read: boolean;
  labels: string[];
  chatgpt_autoresponse_enabled: boolean;
  responsible_email?: string | null;
  responsible_name?: string;
  whatsapp_account_id: string;
  chat_url: string;
  created_timestamp: string;
  last_message_uid?: string;
  last_message_timestamp?: string;
  unattended: boolean;
  photo?: string;
  is_allowed_to_message?: boolean;
}

export interface ChatListData {
  has_more_pages: boolean;
  chats: ChatInfo[];
}

export type ChatListResponse = ApiStatusResponse<ChatListData>;
export type ChatInfoResponse = ApiStatusResponse<ChatInfo>;

export interface ChatUpdateInput {
  name?: string;
  responsible?: string;
  closed?: boolean;
  read?: boolean;
  chatgpt_autoresponse_enabled?: boolean;
}

export interface ListChatsParams {
  label?: string;
  whatsapp_account_id?: string;
  group?: boolean;
  responsible?: string;
  name?: string;
  phone?: string;
  read?: boolean;
  closed?: boolean;
  chatgpt_autoresponse_enabled?: boolean;
  page?: number;
  created_after?: string;
  created_before?: string;
}

export interface MessagePayload {
  text?: string;
  file_uid?: string;
  label?: string;
  chat_name?: string;
  attachment_template_id?: number;
  reply_to?: string | null;
}

export interface MessageToPhoneInput extends MessagePayload {
  phone: string;
  whatsapp_account_phone?: string;
}

export interface MessageSendData {
  message_uid: string;
}

export type MessageSendResponse = ApiStatusResponse<MessageSendData>;

export interface MessageInfo {
  uid: string;
  chat_id: number;
  timestamp: string;
  received_timestamp: string;
  sender_phone: string;
  sender_name: string;
  recipient_phone: string;
  recipient_name: string;
  from_me: boolean;
  text?: string | null;
  attachment_url?: string;
  attachment_filename?: string;
  status: string;
  origin: string;
  has_attachment: boolean;
  message_type: string;
  data?: Record<string, unknown>;
  created_by: string;
}

export interface MessageListData {
  has_more_pages: boolean;
  messages: MessageInfo[];
}

export type MessageListResponse = ApiStatusResponse<MessageListData>;

export interface ListChatMessagesParams {
  from_me?: boolean;
  after?: string;
  before?: string;
  after_message?: string;
  before_message?: string;
  sorting_order?: 'asc' | 'desc';
  page?: number;
}

export interface WhatsappAccountItem {
  id: string;
  phone: string;
  connected_on: string;
  status: string;
  owner_name: string;
  owner_email: string;
  account_name: string;
}

export interface WhatsappAccountsList {
  whatsapp_accounts: WhatsappAccountItem[];
}

export type WhatsappAccountsResponse = ApiStatusResponse<WhatsappAccountsList>;

export interface ErrorResponse {
  status: 'error';
  message?: string;
  error?: string;
}

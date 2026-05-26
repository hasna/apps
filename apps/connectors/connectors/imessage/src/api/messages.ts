import type { ImessageClient } from './client';
import type { IMessage, IMessageAttachment } from '../types';

export interface ListMessagesOptions {
  chatGuid: string;
  limit?: number;
  offset?: number;
  before?: string;
  after?: string;
}

export interface SendMessageOptions {
  chatGuid?: string;
  recipient?: string;
  text: string;
  method?: string;
  effectId?: string;
}

export interface ReplyMessageOptions {
  text: string;
  selectedMessageGuid: string;
}

/**
 * Message API module - send, receive, and manage iMessages
 */
export class MessagesApi {
  constructor(private readonly client: ImessageClient) {}

  /**
   * List messages for a conversation
   */
  async list(options: ListMessagesOptions): Promise<IMessage[]> {
    const params: Record<string, string | number | undefined> = {
      chatGuid: options.chatGuid,
    };
    if (options.limit) params.limit = options.limit;
    if (options.offset) params.offset = options.offset;
    if (options.before) params.before = options.before;
    if (options.after) params.after = options.after;
    return this.client.get<IMessage[]>('/messages', params);
  }

  /**
   * Iterate over all messages (handles pagination)
   */
  async *listAll(options: ListMessagesOptions): AsyncGenerator<IMessage> {
    let offset = options.offset || 0;
    const limit = options.limit || 50;

    while (true) {
      const messages = await this.list({ ...options, limit, offset });
      if (messages.length === 0) break;
      for (const message of messages) {
        yield message;
      }
      if (messages.length < limit) break;
      offset += messages.length;
    }
  }

  /**
   * Send a message to a conversation
   */
  async send(options: SendMessageOptions): Promise<IMessage> {
    const body: Record<string, unknown> = {
      text: options.text,
    };
    if (options.chatGuid) body.chatGuid = options.chatGuid;
    if (options.recipient) body.recipient = options.recipient;
    if (options.method) body.method = options.method;
    if (options.effectId) body.effectId = options.effectId;
    return this.client.post<IMessage>('/messages', body);
  }

  /**
   * Send a reply to a specific message (tapback or quoted reply)
   */
  async reply(messageGuid: string, options: ReplyMessageOptions): Promise<IMessage> {
    const body: Record<string, unknown> = {
      text: options.text,
      selectedMessageGuid: options.selectedMessageGuid,
    };
    return this.client.post<IMessage>(`/messages/${messageGuid}/reply`, body);
  }

  /**
   * Get a specific message by GUID
   */
  async get(messageGuid: string): Promise<IMessage> {
    return this.client.get<IMessage>(`/messages/${messageGuid}`);
  }

  /**
   * Download a message attachment
   */
  async downloadAttachment(attachmentGuid: string): Promise<ArrayBuffer> {
    return this.client.request<ArrayBuffer>(`/attachments/${attachmentGuid}`, {
      method: 'GET',
    });
  }

  /**
   * Send a tapback (reaction) to a message
   */
  async tapback(messageGuid: string, tapback: string): Promise<IMessage> {
    return this.client.post<IMessage>(`/messages/${messageGuid}/tapback`, {
      tapback,
    } as unknown as Record<string, unknown>);
  }

  /**
   * Mark messages as read in a conversation
   */
  async markRead(chatGuid: string): Promise<void> {
    await this.client.post<void>(`/conversations/${encodeURIComponent(chatGuid)}/read`);
  }
}

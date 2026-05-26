import type { QuoClient } from './client';
import type { Message, MessageListResponse, SendMessageParams } from '../types';

export interface ListMessagesOptions {
  phoneNumberId?: string;
  conversationId?: string;
  maxResults?: number;
  pageToken?: string;
}

/**
 * Messages API module
 * Send and receive SMS messages (MMS not supported via API)
 */
export class MessagesApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List messages with optional filters
   */
  async list(options?: ListMessagesOptions): Promise<MessageListResponse> {
    return this.client.get<MessageListResponse>('/messages', {
      phoneNumberId: options?.phoneNumberId,
      conversationId: options?.conversationId,
      maxResults: options?.maxResults,
      pageToken: options?.pageToken,
    });
  }

  /**
   * Get a message by ID
   */
  async get(messageId: string): Promise<{ data: Message }> {
    return this.client.get<{ data: Message }>(`/messages/${messageId}`);
  }

  /**
   * Send a text message (SMS only, MMS not supported)
   * @param from - The phone number ID to send from
   * @param to - Array of recipient phone numbers
   * @param text - The message text
   */
  async send(params: SendMessageParams): Promise<{ data: Message }> {
    return this.client.post<{ data: Message }>('/messages', {
      from: params.from,
      to: params.to,
      text: params.text,
    });
  }
}

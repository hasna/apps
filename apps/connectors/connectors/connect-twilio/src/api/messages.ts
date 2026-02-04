import type { TwilioClient } from './client';
import type {
  Message,
  MessageListResponse,
  SendMessageParams,
  ListMessagesParams,
} from '../types';

/**
 * Twilio Messages API
 * Send, list, get, and delete SMS/MMS messages
 */
export class MessagesApi {
  constructor(private readonly client: TwilioClient) {}

  /**
   * Send an SMS or MMS message
   */
  async send(params: SendMessageParams): Promise<Message> {
    return this.client.post<Message>(
      `/Accounts/{AccountSid}/Messages.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List messages with optional filters
   */
  async list(params?: ListMessagesParams): Promise<MessageListResponse> {
    return this.client.get<MessageListResponse>(
      `/Accounts/{AccountSid}/Messages.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a single message by SID
   */
  async get(messageSid: string): Promise<Message> {
    return this.client.get<Message>(
      `/Accounts/{AccountSid}/Messages/${messageSid}.json`
    );
  }

  /**
   * Update a message (only body can be redacted)
   */
  async update(messageSid: string, body: string): Promise<Message> {
    return this.client.post<Message>(
      `/Accounts/{AccountSid}/Messages/${messageSid}.json`,
      { Body: body }
    );
  }

  /**
   * Delete a message
   */
  async delete(messageSid: string): Promise<void> {
    await this.client.delete(
      `/Accounts/{AccountSid}/Messages/${messageSid}.json`
    );
  }

  /**
   * Get media for a message
   */
  async listMedia(messageSid: string): Promise<{ media_list: Array<{ sid: string; content_type: string; uri: string }> }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Messages/${messageSid}/Media.json`
    );
  }

  /**
   * Delete media from a message
   */
  async deleteMedia(messageSid: string, mediaSid: string): Promise<void> {
    await this.client.delete(
      `/Accounts/{AccountSid}/Messages/${messageSid}/Media/${mediaSid}.json`
    );
  }

  /**
   * List all messages, auto-paginating through results
   */
  async *listAll(params?: ListMessagesParams): AsyncGenerator<Message, void, unknown> {
    let page = 0;
    const pageSize = params?.PageSize || 50;

    while (true) {
      const response = await this.list({
        ...params,
        Page: page,
        PageSize: pageSize,
      });

      for (const message of response.messages) {
        yield message;
      }

      if (!response.next_page_uri) {
        break;
      }

      page++;
    }
  }
}

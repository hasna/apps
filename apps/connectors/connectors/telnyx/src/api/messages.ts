import type { TelnyxClient } from './client';
import type { Message, SendMessageParams, TelnyxResponse } from '../types';

/**
 * Telnyx Messaging API.
 *
 * Telnyx exposes send (`POST /messages`) and retrieve (`GET /messages/{id}`).
 * There is no "list messages" endpoint upstream, so it is intentionally omitted.
 */
export class MessagesApi {
  constructor(private readonly client: TelnyxClient) {}

  /**
   * Send an SMS or MMS message.
   * Requires `to` plus either `from` (a Telnyx number) or `messaging_profile_id`.
   */
  async send(params: SendMessageParams): Promise<Message> {
    if (!params.to) {
      throw new Error('A "to" phone number is required to send a message');
    }
    if (!params.from && !params.messaging_profile_id) {
      throw new Error('Either "from" or "messaging_profile_id" is required to send a message');
    }

    const body: Record<string, unknown> = {
      to: params.to,
      from: params.from,
      text: params.text,
      messaging_profile_id: params.messaging_profile_id,
      subject: params.subject,
      media_urls: params.media_urls,
      webhook_url: params.webhook_url,
      webhook_failover_url: params.webhook_failover_url,
      use_profile_webhooks: params.use_profile_webhooks,
      type: params.type,
    };

    const response = await this.client.post<TelnyxResponse<Message>>('/messages', body);
    return response.data;
  }

  /**
   * Retrieve a previously sent or received message by its ID.
   */
  async get(id: string): Promise<Message> {
    if (!id) {
      throw new Error('A message ID is required');
    }
    const response = await this.client.get<TelnyxResponse<Message>>(
      `/messages/${encodeURIComponent(id)}`
    );
    return response.data;
  }
}

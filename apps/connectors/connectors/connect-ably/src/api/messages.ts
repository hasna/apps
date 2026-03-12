import type { ConnectorClient } from './client';
import type {
  Message,
  PublishMessageParams,
  PublishMessageResult,
  MessageHistoryParams,
} from '../types';

export class MessagesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Publish a message to a channel
   * POST /channels/{channelId}/messages
   */
  async publish(channelId: string, params: PublishMessageParams): Promise<PublishMessageResult> {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.data !== undefined) body.data = params.data;
    if (params.id !== undefined) body.id = params.id;
    if (params.clientId !== undefined) body.clientId = params.clientId;
    if (params.extras !== undefined) body.extras = params.extras;

    await this.client.post(`/channels/${encodeURIComponent(channelId)}/messages`, body);

    return {
      channel: channelId,
      messageId: params.id || '',
    };
  }

  /**
   * Get message history for a channel
   * GET /channels/{channelId}/messages
   */
  async history(channelId: string, params?: MessageHistoryParams): Promise<Message[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.start) queryParams.start = params.start;
    if (params?.end) queryParams.end = params.end;
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.direction) queryParams.direction = params.direction;

    return this.client.get<Message[]>(
      `/channels/${encodeURIComponent(channelId)}/messages`,
      queryParams,
    );
  }
}

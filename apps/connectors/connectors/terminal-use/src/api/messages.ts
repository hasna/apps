import type { ListMessagesParams } from '../types';
import { normalizeQueryParams } from '../types';
import type { ConnectorClient } from './client';

export class MessagesApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params: ListMessagesParams = {}): Promise<unknown> {
    return this.client.get('/v2/messages', normalizeQueryParams(params as Record<string, unknown>));
  }

  get(messageId: string): Promise<unknown> {
    if (!messageId) {
      throw new Error('message_id is required');
    }
    return this.client.get(`/v2/messages/${encodeURIComponent(messageId)}`);
  }
}

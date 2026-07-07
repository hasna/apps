import type { MessageSendPayload } from '../types';
import type { ConnectorClient } from './client';

export class MessagesApi {
  constructor(private readonly client: ConnectorClient) {}

  send(payload: MessageSendPayload): Promise<void> {
    return this.client.post('/messages', payload as unknown as Record<string, unknown>);
  }
}

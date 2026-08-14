import type { UsereframeClient } from './client';

export class AssistantApi {
  constructor(private readonly client: UsereframeClient) {}

  sendMessage(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/assistant/messages', body);
  }
}

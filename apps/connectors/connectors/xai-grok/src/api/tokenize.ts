import type { XAIGrokClient } from './client';

export class TokenizeApi {
  constructor(private readonly client: XAIGrokClient) {}

  text(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/tokenize-text', body);
  }
}

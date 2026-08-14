import type { XAIGrokClient } from './client';

export class ResponsesApi {
  constructor(private readonly client: XAIGrokClient) {}

  create(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/responses', body);
  }

  get(responseId: string): Promise<unknown> {
    return this.client.get(`/responses/${encodeURIComponent(responseId)}`);
  }

  delete(responseId: string): Promise<unknown> {
    return this.client.delete(`/responses/${encodeURIComponent(responseId)}`);
  }

  cancel(responseId: string): Promise<unknown> {
    return this.client.post(`/responses/${encodeURIComponent(responseId)}/cancel`);
  }
}

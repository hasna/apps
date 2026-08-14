import type { TinesClient } from './client';
import type { TinesAgent } from '../types';

export class AgentsApi {
  constructor(private readonly client: TinesClient) {}

  list(options: { storyId?: number; perPage?: number; page?: number } = {}): Promise<TinesAgent[]> {
    return this.client.request<TinesAgent[]>('/agents', {
      params: {
        story_id: options.storyId,
        per_page: options.perPage,
        page: options.page,
      },
    });
  }

  get(id: number): Promise<TinesAgent> {
    return this.client.request<TinesAgent>(`/agents/${id}`);
  }

  run(id: number, payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.request(`/agents/${id}/events`, {
      method: 'POST',
      body: payload,
    });
  }

  test(agentId: number, eventId?: number): Promise<unknown> {
    return this.client.request(`/agents/${agentId}/test`, {
      method: 'POST',
      body: { event_id: eventId },
    });
  }

  delete(id: number): Promise<unknown> {
    return this.client.request(`/agents/${id}`, { method: 'DELETE' });
  }
}

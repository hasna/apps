import type { TinesClient } from './client';
import type { TinesEvent } from '../types';

export class EventsApi {
  constructor(private readonly client: TinesClient) {}

  list(options: {
    agentId?: number;
    storyId?: number;
    perPage?: number;
    page?: number;
  } = {}): Promise<TinesEvent[]> {
    return this.client.request<TinesEvent[]>('/events', {
      params: {
        agent_id: options.agentId,
        story_id: options.storyId,
        per_page: options.perPage,
        page: options.page,
      },
    });
  }

  get(id: number): Promise<TinesEvent> {
    return this.client.request<TinesEvent>(`/events/${id}`);
  }
}

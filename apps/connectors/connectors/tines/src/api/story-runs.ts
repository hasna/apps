import type { TinesClient } from './client';
import type { TinesStoryRun } from '../types';

export class StoryRunsApi {
  constructor(private readonly client: TinesClient) {}

  list(options: {
    storyId: number;
    perPage?: number;
    page?: number;
    status?: string;
  }): Promise<TinesStoryRun[]> {
    return this.client.request<TinesStoryRun[]>('/story_runs', {
      params: {
        story_id: options.storyId,
        per_page: options.perPage,
        page: options.page,
        status: options.status,
      },
    });
  }

  get(id: number): Promise<TinesStoryRun> {
    return this.client.request<TinesStoryRun>(`/story_runs/${id}`);
  }

  stop(id: number): Promise<unknown> {
    return this.client.request(`/story_runs/${id}/stop`, { method: 'POST' });
  }
}

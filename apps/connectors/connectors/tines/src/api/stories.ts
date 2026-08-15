import type { TinesClient } from './client';
import type { PaginationParams, TinesStory } from '../types';

export class StoriesApi {
  constructor(private readonly client: TinesClient) {}

  list(options: {
    teamId?: number;
    folderId?: number;
    tags?: string;
    perPage?: number;
    page?: number;
  } = {}): Promise<TinesStory[]> {
    return this.client.request<TinesStory[]>('/stories', {
      params: {
        team_id: options.teamId,
        folder_id: options.folderId,
        tags: options.tags,
        per_page: options.perPage,
        page: options.page,
      },
    });
  }

  get(id: number): Promise<TinesStory> {
    return this.client.request<TinesStory>(`/stories/${id}`);
  }

  create(options: {
    teamId: number;
    name: string;
    description?: string;
    folderId?: number;
    disabled?: boolean;
  }): Promise<TinesStory> {
    return this.client.request<TinesStory>('/stories', {
      method: 'POST',
      body: {
        team_id: options.teamId,
        name: options.name,
        description: options.description,
        folder_id: options.folderId,
        disabled: options.disabled,
      },
    });
  }

  update(
    id: number,
    options: {
      name?: string;
      description?: string;
      folderId?: number;
      disabled?: boolean;
    },
  ): Promise<TinesStory> {
    return this.client.request<TinesStory>(`/stories/${id}`, {
      method: 'PUT',
      body: {
        name: options.name,
        description: options.description,
        folder_id: options.folderId,
        disabled: options.disabled,
      },
    });
  }

  delete(id: number): Promise<unknown> {
    return this.client.request(`/stories/${id}`, { method: 'DELETE' });
  }

  export(id: number): Promise<unknown> {
    return this.client.request(`/stories/${id}/export`);
  }

  importStory(options: {
    teamId: number;
    folderId?: number;
    newName?: string;
    mode?: string;
    data: Record<string, unknown>;
  }): Promise<TinesStory> {
    return this.client.request<TinesStory>('/stories/import', {
      method: 'POST',
      body: {
        team_id: options.teamId,
        folder_id: options.folderId,
        new_name: options.newName,
        mode: options.mode,
        data: options.data,
      },
    });
  }
}

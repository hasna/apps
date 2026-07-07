import type { TinesClient } from './client';
import type { TinesFolder } from '../types';

export class FoldersApi {
  constructor(private readonly client: TinesClient) {}

  list(options: { teamId?: number; perPage?: number; page?: number } = {}): Promise<TinesFolder[]> {
    return this.client.request<TinesFolder[]>('/folders', {
      params: {
        team_id: options.teamId,
        per_page: options.perPage,
        page: options.page,
      },
    });
  }

  create(options: { teamId: number; name: string; contentType?: string }): Promise<TinesFolder> {
    return this.client.request<TinesFolder>('/folders', {
      method: 'POST',
      body: {
        team_id: options.teamId,
        name: options.name,
        content_type: options.contentType,
      },
    });
  }

  delete(id: number): Promise<unknown> {
    return this.client.request(`/folders/${id}`, { method: 'DELETE' });
  }
}

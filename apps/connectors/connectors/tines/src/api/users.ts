import type { TinesClient } from './client';
import type { TinesUser } from '../types';

export class UsersApi {
  constructor(private readonly client: TinesClient) {}

  list(options: { teamId?: number; perPage?: number; page?: number } = {}): Promise<TinesUser[]> {
    return this.client.request<TinesUser[]>('/users', {
      params: {
        team_id: options.teamId,
        per_page: options.perPage,
        page: options.page,
      },
    });
  }
}

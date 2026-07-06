import type { TinesClient } from './client';
import type { TinesTeam } from '../types';

export class TeamsApi {
  constructor(private readonly client: TinesClient) {}

  list(options: { perPage?: number; page?: number } = {}): Promise<TinesTeam[]> {
    return this.client.request<TinesTeam[]>('/teams', {
      params: {
        per_page: options.perPage,
        page: options.page,
      },
    });
  }
}

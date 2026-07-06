import type { TinesClient } from './client';
import type { TinesCredential } from '../types';

export class CredentialsApi {
  constructor(private readonly client: TinesClient) {}

  list(options: { teamId?: number; perPage?: number; page?: number } = {}): Promise<TinesCredential[]> {
    return this.client.request<TinesCredential[]>('/user_credentials', {
      params: {
        team_id: options.teamId,
        per_page: options.perPage,
        page: options.page,
      },
    });
  }

  create(options: {
    teamId: number;
    name: string;
    mode: string;
    value?: string;
    description?: string;
  }): Promise<TinesCredential> {
    return this.client.request<TinesCredential>('/user_credentials', {
      method: 'POST',
      body: {
        team_id: options.teamId,
        name: options.name,
        mode: options.mode,
        value: options.value,
        description: options.description,
      },
    });
  }

  delete(id: number): Promise<unknown> {
    return this.client.request(`/user_credentials/${id}`, { method: 'DELETE' });
  }
}

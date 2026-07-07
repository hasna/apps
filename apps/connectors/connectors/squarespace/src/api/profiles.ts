import type { SquarespaceClient } from './client';
import type { Profile } from '../types';

export interface ListProfilesOptions {
  cursor?: string;
  filter?: string;
  sortDirection?: 'asc' | 'desc';
  sortField?: string;
}

export interface ProfilesListResponse {
  profiles: Profile[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class ProfilesApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(options: ListProfilesOptions = {}): Promise<ProfilesListResponse> {
    return this.client.request<ProfilesListResponse>('/profiles', {
      params: {
        cursor: options.cursor,
        filter: options.filter,
        sortDirection: options.sortDirection,
        sortField: options.sortField,
      },
    });
  }

  async get(id: string): Promise<Profile> {
    return this.client.request<Profile>(`/profiles/${encodeURIComponent(id)}`);
  }

  async create(profile: Record<string, unknown>): Promise<Profile> {
    return this.client.request<Profile>('/profiles', {
      method: 'POST',
      body: profile,
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<Profile> {
    return this.client.request<Profile>(`/profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    });
  }
}

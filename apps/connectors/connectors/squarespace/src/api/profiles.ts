import type { SquarespaceClient } from './client';
import type { Profile } from '../types';

export interface ListProfilesOptions {
  cursor?: string;
  filter?: string;
  sortDirection?: 'asc' | 'dsc';
  sortField?: string;
}

export interface ProfilesListResponse {
  profiles: Profile[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export interface ProfilesGetResponse {
  profiles: Profile[];
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

  async get(profileIds: string | string[]): Promise<ProfilesGetResponse> {
    const ids = (Array.isArray(profileIds) ? profileIds : [profileIds]).map(encodeURIComponent).join(',');
    return this.client.request<ProfilesGetResponse>(`/profiles/${ids}`);
  }
}

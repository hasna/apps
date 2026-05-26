import type { BrowserUseClient } from './client';
import type {
  Profile,
  CreateProfileParams,
  UpdateProfileParams,
  ListProfilesParams,
  PaginatedResponse,
} from '../types';

/**
 * Profiles API (Browser Profiles for persistent state)
 */
export class ProfilesApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * List all profiles
   */
  async list(params?: ListProfilesParams): Promise<PaginatedResponse<Profile>> {
    return this.client.get<PaginatedResponse<Profile>>('/v2/profiles', {
      limit: params?.limit,
      cursor: params?.cursor,
    });
  }

  /**
   * Create a new profile
   */
  async create(params: CreateProfileParams): Promise<Profile> {
    return this.client.post<Profile>('/v2/profiles', {
      name: params.name,
      description: params.description,
    });
  }

  /**
   * Get a profile by ID
   */
  async get(profileId: string): Promise<Profile> {
    return this.client.get<Profile>(`/v2/profiles/${profileId}`);
  }

  /**
   * Update a profile
   */
  async update(profileId: string, params: UpdateProfileParams): Promise<Profile> {
    return this.client.patch<Profile>(`/v2/profiles/${profileId}`, {
      name: params.name,
      description: params.description,
    });
  }

  /**
   * Delete a profile
   */
  async delete(profileId: string): Promise<void> {
    await this.client.delete(`/v2/profiles/${profileId}`);
  }
}

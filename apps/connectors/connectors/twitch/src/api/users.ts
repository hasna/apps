import type { TwitchClient } from './client';
import type { HelixListResponse, TwitchUser } from '../types';

interface HelixUserRaw {
  id: string;
  login: string;
  display_name: string;
  type: string;
  broadcaster_type: string;
  description: string;
  profile_image_url: string;
  created_at: string;
}

export class UsersApi {
  constructor(private readonly client: TwitchClient) {}

  async getUser(login?: string): Promise<TwitchUser | null> {
    const params: Record<string, string | undefined> = {};
    if (login) params.login = login.replace(/^@/, '');
    const response = await this.client.request<HelixListResponse<HelixUserRaw>>('/users', { params });
    const user = response.data[0];
    return user ? this.parseUser(user) : null;
  }

  private parseUser(raw: HelixUserRaw): TwitchUser {
    return {
      id: raw.id,
      login: raw.login,
      displayName: raw.display_name,
      type: raw.type,
      broadcasterType: raw.broadcaster_type,
      description: raw.description,
      profileImageUrl: raw.profile_image_url,
      createdAt: raw.created_at,
    };
  }
}

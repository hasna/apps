import type { TwitchClient } from './client';
import type { HelixListResponse, TwitchFollower } from '../types';

interface HelixFollowerRaw {
  user_id: string;
  user_login: string;
  user_name: string;
  followed_at: string;
}

export class FollowersApi {
  constructor(private readonly client: TwitchClient) {}

  async listFollowers(
    broadcasterId: string,
    first = 20,
  ): Promise<{ total?: number; followers: TwitchFollower[] }> {
    const limit = Math.min(100, Math.max(1, first));
    const response = await this.client.request<HelixListResponse<HelixFollowerRaw> & { total?: number }>(
      '/channels/followers',
      {
        params: {
          broadcaster_id: broadcasterId,
          first: limit,
        },
      },
    );
    return {
      total: response.total,
      followers: response.data.map((f) => ({
        userId: f.user_id,
        userLogin: f.user_login,
        userName: f.user_name,
        followedAt: f.followed_at,
      })),
    };
  }
}

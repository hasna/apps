import type { TwitchClient } from './client';
import type { HelixListResponse, TwitchSearchChannel } from '../types';

interface HelixSearchChannelRaw {
  id: string;
  display_name: string;
  broadcaster_login: string;
  game_id: string;
  game_name: string;
  title: string;
  is_live: boolean;
  started_at?: string;
}

export class SearchApi {
  constructor(private readonly client: TwitchClient) {}

  async searchChannels(query: string, first = 10): Promise<TwitchSearchChannel[]> {
    const limit = Math.min(100, Math.max(1, first));
    const response = await this.client.request<HelixListResponse<HelixSearchChannelRaw>>(
      '/search/channels',
      {
        params: { query, first: limit },
      },
    );
    return response.data.map((c) => ({
      id: c.id,
      displayName: c.display_name,
      broadcasterLogin: c.broadcaster_login,
      gameId: c.game_id,
      gameName: c.game_name,
      title: c.title,
      isLive: c.is_live,
      startedAt: c.started_at ?? null,
    }));
  }
}

import type { TwitchClient } from './client';
import type { HelixListResponse, TwitchChannel } from '../types';

interface HelixChannelRaw {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  game_name: string;
  game_id: string;
  title: string;
  broadcaster_language: string;
  tags: string[];
}

export class ChannelsApi {
  constructor(private readonly client: TwitchClient) {}

  async getChannelInfo(broadcasterId: string): Promise<TwitchChannel | null> {
    const response = await this.client.request<HelixListResponse<HelixChannelRaw>>('/channels', {
      params: { broadcaster_id: broadcasterId },
    });
    const channel = response.data[0];
    return channel ? this.parseChannel(channel) : null;
  }

  private parseChannel(raw: HelixChannelRaw): TwitchChannel {
    return {
      broadcasterId: raw.broadcaster_id,
      broadcasterLogin: raw.broadcaster_login,
      broadcasterName: raw.broadcaster_name,
      gameName: raw.game_name,
      gameId: raw.game_id,
      title: raw.title,
      broadcasterLanguage: raw.broadcaster_language,
      tags: raw.tags ?? [],
    };
  }
}

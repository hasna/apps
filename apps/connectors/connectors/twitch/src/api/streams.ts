import type { TwitchClient } from './client';
import type { HelixListResponse, TwitchStream } from '../types';

interface HelixStreamRaw {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
}

export interface GetStreamsOptions {
  gameId?: string;
  userLogin?: string;
  first?: number;
  after?: string;
}

export class StreamsApi {
  constructor(private readonly client: TwitchClient) {}

  async getStreams(options: GetStreamsOptions = {}): Promise<TwitchStream[]> {
    const first = clampLimit(options.first, 20, 100);
    const response = await this.client.request<HelixListResponse<HelixStreamRaw>>('/streams', {
      params: {
        game_id: options.gameId,
        user_login: options.userLogin?.replace(/^@/, ''),
        first,
        after: options.after,
      },
    });
    return response.data.map((s) => this.parseStream(s));
  }

  private parseStream(raw: HelixStreamRaw): TwitchStream {
    return {
      id: raw.id,
      userId: raw.user_id,
      userLogin: raw.user_login,
      userName: raw.user_name,
      gameId: raw.game_id,
      gameName: raw.game_name,
      type: raw.type,
      title: raw.title,
      viewerCount: raw.viewer_count,
      startedAt: raw.started_at,
      language: raw.language,
    };
  }
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value!)));
}

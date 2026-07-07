import type { ConnectorClient } from './client';
import type { StreakComment } from '../types';

export class CommentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(boxKey: string): Promise<StreakComment[]> {
    return this.client.getV2<StreakComment[]>(
      `/boxes/${encodeURIComponent(boxKey)}/comments`,
    );
  }

  async create(boxKey: string, message: string): Promise<StreakComment> {
    return this.client.postV2<StreakComment>(
      `/boxes/${encodeURIComponent(boxKey)}/comments`,
      { message },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.deleteV2(`/comments/${encodeURIComponent(key)}`);
  }
}

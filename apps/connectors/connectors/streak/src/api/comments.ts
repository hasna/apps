import type { ConnectorClient } from './client';
import type { StreakComment } from '../types';

export class CommentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(boxKey: string): Promise<StreakComment[]> {
    return this.client.get<StreakComment[]>(
      `/boxes/${encodeURIComponent(boxKey)}/comments`,
    );
  }

  async create(boxKey: string, message: string): Promise<StreakComment> {
    return this.client.put<StreakComment>(
      `/boxes/${encodeURIComponent(boxKey)}/comments`,
      { message },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(`/comments/${encodeURIComponent(key)}`);
  }
}

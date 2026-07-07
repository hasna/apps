import type { SonarQubeClient } from './client';
import type { UsersSearchResponse } from '../types';

export class UsersApi {
  constructor(private readonly client: SonarQubeClient) {}

  async search(options?: {
    q?: string;
    p?: number;
    ps?: number;
  }): Promise<UsersSearchResponse> {
    return this.client.get<UsersSearchResponse>('/api/users/search', options);
  }
}

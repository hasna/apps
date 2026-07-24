import type { ConnectorClient } from './client';
import type { UserTrackParams, WebEngageResponse } from '../types';

export class UsersApi {
  constructor(private readonly client: ConnectorClient) {}

  async track(data: UserTrackParams): Promise<WebEngageResponse> {
    return this.client.post<WebEngageResponse>(
      this.client.accountPath('v1', '/users'),
      data
    );
  }
}

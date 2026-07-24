import type { ConnectorClient } from './client';
import type { BulkEventsParams, BulkUsersParams, WebEngageResponse } from '../types';

export class BulkApi {
  constructor(private readonly client: ConnectorClient) {}

  async trackUsers(data: BulkUsersParams): Promise<WebEngageResponse> {
    return this.client.post<WebEngageResponse>(
      this.client.accountPath('v1', '/bulk-users'),
      data
    );
  }

  async trackEvents(data: BulkEventsParams): Promise<WebEngageResponse> {
    return this.client.post<WebEngageResponse>(
      this.client.accountPath('v1', '/bulk-events'),
      data
    );
  }
}

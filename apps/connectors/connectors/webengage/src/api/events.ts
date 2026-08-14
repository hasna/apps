import type { ConnectorClient } from './client';
import type { EventTrackParams, WebEngageResponse } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async track(data: EventTrackParams): Promise<WebEngageResponse> {
    return this.client.post<WebEngageResponse>(
      this.client.accountPath('v1', '/events'),
      data
    );
  }
}

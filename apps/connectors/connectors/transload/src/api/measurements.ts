import type { ConnectorClient } from './client';
import type { SyncMeasurementsResponse } from '../types';

export class MeasurementsApi {
  constructor(private readonly client: ConnectorClient) {}

  async sync(body?: Record<string, unknown>): Promise<SyncMeasurementsResponse> {
    return this.client.post<SyncMeasurementsResponse>('/measurements/sync', body ?? {});
  }
}

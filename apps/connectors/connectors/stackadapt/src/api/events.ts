import type { ConnectorClient } from './client';
import type { ConversionTracker, StatsParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List conversion trackers (pixel / event tracking resources). */
  async list(): Promise<ConversionTracker[]> {
    const result = await this.client.get<ConversionTracker[] | { conversion_trackers?: ConversionTracker[] }>(
      '/conversion_trackers'
    );
    if (Array.isArray(result)) {
      return result;
    }
    return result.conversion_trackers ?? [];
  }

  async get(id: string | number): Promise<ConversionTracker> {
    return this.client.get<ConversionTracker>(`/conversion_tracker/${id}`);
  }

  async stats(params: StatsParams): Promise<unknown> {
    return this.client.get('/stats', {
      resource: params.resource,
      type: params.type,
      id: params.id,
      start_date: params.start_date,
      end_date: params.end_date,
      timezone: params.timezone,
      group_by_resource: params.group_by_resource,
    });
  }
}

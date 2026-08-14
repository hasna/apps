import type { ConnectorClient } from './client';
import type { EventListResponse, UnleashEvent } from '../types';

/**
 * Unleash event log Admin API
 * @see https://docs.getunleash.io/reference/api-unleash/admin-events
 */
export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List recent events from the Unleash instance
   */
  async list(params?: { project?: string; feature?: string; limit?: number }): Promise<UnleashEvent[]> {
    const response = await this.client.get<EventListResponse>('/admin/events', {
      project: params?.project,
      feature: params?.feature,
      limit: params?.limit,
    });
    return response.events;
  }
}

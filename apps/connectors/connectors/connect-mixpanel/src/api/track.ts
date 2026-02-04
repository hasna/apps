import { MixpanelClient } from './client';
import type { TrackEvent, TrackResponse, TrackBatchResponse, TrackEventProperties } from '../types';

/**
 * Mixpanel Track API
 * Track events and user actions
 */
export class TrackApi {
  constructor(private readonly client: MixpanelClient) {}

  /**
   * Track a single event
   */
  async track(
    event: string,
    properties: Omit<TrackEventProperties, 'token'> = {}
  ): Promise<TrackResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for tracking');
    }

    const eventData: TrackEvent = {
      event,
      properties: {
        token: projectToken,
        time: Math.floor(Date.now() / 1000),
        ...properties,
      },
    };

    return this.client.trackRequest<TrackResponse>('/track', eventData);
  }

  /**
   * Track multiple events in a batch using the import endpoint
   * Note: Import endpoint uses Basic Auth (service account or API secret), not project token
   */
  async trackBatch(events: Array<{ event: string; properties?: Omit<TrackEventProperties, 'token'> }>): Promise<TrackBatchResponse> {
    const eventData = events.map(e => ({
      event: e.event,
      properties: {
        time: Math.floor(Date.now() / 1000),
        $insert_id: crypto.randomUUID(), // Required for deduplication
        ...e.properties,
      },
    }));

    return this.client.importRequest<TrackBatchResponse>('/import', eventData);
  }

  /**
   * Import historical events using the import endpoint
   * Events must have a time property set in the past
   * Note: Import endpoint uses Basic Auth (service account or API secret), not project token
   */
  async import(events: TrackEvent[]): Promise<TrackBatchResponse> {
    // Ensure each event has required fields for import
    const eventsForImport = events.map(e => ({
      event: e.event,
      properties: {
        $insert_id: crypto.randomUUID(), // Required for deduplication if not provided
        ...e.properties,
      },
    }));

    return this.client.importRequest<TrackBatchResponse>('/import', eventsForImport);
  }
}

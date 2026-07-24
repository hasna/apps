import type { WistiaClient } from './client';
import type { StatsDateRange, ListEventsParams } from '../types';

export class StatsApi {
  constructor(private readonly client: WistiaClient) {}

  async listVisitors(
    options: StatsDateRange & Pick<ListEventsParams, 'page' | 'perPage'> = {},
  ): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>('/v1/stats/visitors.json', {
      start_date: options.startDate,
      end_date: options.endDate,
      per_page: options.perPage,
      page: options.page,
    });
  }

  async listEvents(options: ListEventsParams = {}): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>('/v1/stats/events.json', {
      media_id: options.mediaId,
      visitor_key: options.visitorKey,
      start_date: options.startDate,
      end_date: options.endDate,
      per_page: options.perPage,
      page: options.page,
    });
  }

  async listMediaEngagement(
    hashedId: string,
    options: StatsDateRange = {},
  ): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(
      `/v1/stats/medias/${encodeURIComponent(hashedId)}/engagement.json`,
      {
        start_date: options.startDate,
        end_date: options.endDate,
      },
    );
  }
}

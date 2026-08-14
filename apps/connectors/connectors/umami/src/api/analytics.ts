import type { UmamiClient } from './client';
import type {
  EventDataParams,
  EventsListParams,
  MetricsParams,
  PageviewsParams,
  StatsQueryParams,
} from '../types';
import { buildQueryParams } from './client';

function withFilters<T extends StatsQueryParams>(
  params: T
): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {
    startAt: params.startAt,
    endAt: params.endAt,
  };

  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      query[key] = value;
    }
  }

  return query;
}

export class AnalyticsApi {
  constructor(private readonly client: UmamiClient) {}

  async getStats(websiteId: string, params: StatsQueryParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/stats`, withFilters(params));
  }

  async getPageviews(websiteId: string, params: PageviewsParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/pageviews`, {
      ...withFilters(params),
      unit: params.unit,
      timezone: params.timezone,
      compare: params.compare,
    });
  }

  async getMetrics(websiteId: string, params: MetricsParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/metrics`, {
      ...withFilters(params),
      type: params.type,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getMetricsExpanded(websiteId: string, params: MetricsParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/metrics/expanded`, {
      ...withFilters(params),
      type: params.type,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getEventsSeries(websiteId: string, params: PageviewsParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/events/series`, {
      ...withFilters(params),
      unit: params.unit,
      timezone: params.timezone,
    });
  }

  async listEvents(websiteId: string, params: EventsListParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/events`, {
      ...withFilters(params),
      search: params.search,
      page: params.page,
      pageSize: params.pageSize,
    });
  }

  async getEventStats(websiteId: string, params: StatsQueryParams & { compare?: 'prev' | 'yoy' }): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/events/stats`, {
      ...withFilters(params),
      compare: params.compare,
    });
  }

  async getEventData(websiteId: string, params: EventDataParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data`, {
      ...withFilters(params),
      page: params.page,
      pageSize: params.pageSize,
    });
  }

  async getEventDataById(websiteId: string, eventId: string): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data/${eventId}`);
  }

  async getEventDataEvents(websiteId: string, params: EventDataParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data/events`, {
      ...withFilters(params),
      event: params.event,
    });
  }

  async getEventDataFields(websiteId: string, params: StatsQueryParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data/fields`, withFilters(params));
  }

  async getEventDataProperties(websiteId: string, params: StatsQueryParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data/properties`, withFilters(params));
  }

  async getEventDataValues(websiteId: string, params: EventDataParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data/values`, {
      ...withFilters(params),
      event: params.event,
      propertyName: params.propertyName,
    });
  }

  async getEventDataStats(websiteId: string, params: StatsQueryParams): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data/stats`, withFilters(params));
  }

  async getEventDataPivot(
    websiteId: string,
    params: EventDataParams & { eventName: string }
  ): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/event-data-pivot`, {
      ...withFilters(params),
      eventName: params.eventName,
      page: params.page,
      pageSize: params.pageSize,
    });
  }
}

export { buildQueryParams };

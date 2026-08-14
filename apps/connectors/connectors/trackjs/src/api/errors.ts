import type {
  ErrorsAggregateParams,
  ErrorsListParams,
  TrackjsAggregateEntry,
  TrackjsDateAggregateEntry,
  TrackjsError,
  TrackjsPaginatedResponse,
} from '../types';
import type { TrackjsClient } from './client';

function toParams(
  params?: ErrorsListParams | ErrorsAggregateParams,
): Record<string, string | number | boolean | undefined> | undefined {
  if (!params) return undefined;
  return { ...params };
}

export class ErrorsApi {
  constructor(private readonly client: TrackjsClient) {}

  list(params?: ErrorsListParams): Promise<TrackjsPaginatedResponse<TrackjsError>> {
    return this.client.get<TrackjsPaginatedResponse<TrackjsError>>('/errors', toParams(params));
  }

  listMessages(params?: ErrorsAggregateParams): Promise<TrackjsPaginatedResponse<TrackjsAggregateEntry>> {
    return this.client.get<TrackjsPaginatedResponse<TrackjsAggregateEntry>>('/errors/messages', toParams(params));
  }

  listUrls(params?: ErrorsAggregateParams): Promise<TrackjsPaginatedResponse<TrackjsAggregateEntry>> {
    return this.client.get<TrackjsPaginatedResponse<TrackjsAggregateEntry>>('/errors/urls', toParams(params));
  }

  listDaily(params?: ErrorsAggregateParams): Promise<TrackjsPaginatedResponse<TrackjsDateAggregateEntry>> {
    return this.client.get<TrackjsPaginatedResponse<TrackjsDateAggregateEntry>>('/errors/daily', toParams(params));
  }

  listHourly(params?: ErrorsAggregateParams): Promise<TrackjsPaginatedResponse<TrackjsDateAggregateEntry>> {
    return this.client.get<TrackjsPaginatedResponse<TrackjsDateAggregateEntry>>('/errors/hourly', toParams(params));
  }
}

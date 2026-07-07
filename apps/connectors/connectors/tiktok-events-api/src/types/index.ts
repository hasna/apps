export type JsonRecord = Record<string, unknown>;

export type TikTokEventSource = 'web' | 'app' | 'offline' | 'crm';

export interface TikTokEventsConfig {
  accessToken: string;
  advertiserId?: string;
  pixelCode?: string;
  appId?: string;
  offlineEventSetId?: string;
  crmEventSetId?: string;
  testEventCode?: string;
  baseUrl?: string;
}

export interface TikTokApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
  request_id?: string;
}

export interface TikTokEventOptions {
  event?: string;
  eventName?: string;
  eventId?: string;
  event_id?: string;
  eventTime?: string | number | Date;
  event_time?: string | number | Date;
  timestamp?: string | number | Date;
  user?: JsonRecord;
  context?: JsonRecord;
  page?: JsonRecord;
  app?: JsonRecord;
  ad?: JsonRecord;
  lead?: JsonRecord;
  properties?: JsonRecord;
  limitedDataUse?: boolean;
  limited_data_use?: boolean;
  extra?: JsonRecord;
}

export interface TikTokTrackOptions extends TikTokEventOptions {
  events?: TikTokEventOptions[];
  eventSource?: TikTokEventSource;
  event_source?: TikTokEventSource;
  eventSourceId?: string;
  event_source_id?: string;
  pixelCode?: string;
  pixel_code?: string;
  appId?: string;
  app_id?: string;
  offlineEventSetId?: string;
  offline_event_set_id?: string;
  crmEventSetId?: string;
  crm_event_set_id?: string;
  testEventCode?: string;
  test_event_code?: string;
  body?: JsonRecord;
  topLevel?: JsonRecord;
  value?: number | string;
  currency?: string;
  contentIds?: string[] | string;
  contentType?: string;
  searchString?: string;
}

export interface TikTokRequestOptions {
  method?: string;
  path: string;
  query?: JsonRecord;
  body?: JsonRecord;
}

export class TikTokEventsApiError extends Error {
  constructor(
    message: string,
    public readonly code: number | string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'TikTokEventsApiError';
  }
}

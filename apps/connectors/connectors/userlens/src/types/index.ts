// Userlens Connector Types

export const DEFAULT_EVENTS_BASE_URL = 'https://events.userlens.io';
export const DEFAULT_RAW_BASE_URL = 'https://raw.userlens.io';
export const DEFAULT_SOURCE = 'userlens-restapi';

export interface UserlensConfig {
  apiKey?: string;
  eventsBaseUrl?: string;
  rawBaseUrl?: string;
}

export interface ProfileConfig {
  apiKey?: string;
  eventsBaseUrl?: string;
  rawBaseUrl?: string;
}

export interface IdentifyBody {
  type: 'identify';
  userId: string;
  source?: string;
  traits?: Record<string, unknown>;
}

export interface GroupBody {
  type: 'group';
  groupId: string;
  userId: string;
  source?: string;
  traits?: Record<string, unknown>;
}

export interface TrackBody {
  type: 'track';
  userId: string;
  event: string;
  source?: string;
  properties?: Record<string, unknown>;
}

export interface RawEvent {
  event: string;
  userId: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RawEventsBody {
  events: RawEvent[];
}

export interface RawRequestOptions {
  path?: string;
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  useRawBase?: boolean;
}

export type OutputFormat = 'json' | 'pretty';

export class UserlensApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'UserlensApiError';
  }
}

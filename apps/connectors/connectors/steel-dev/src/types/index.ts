// Steel Dev Connector Types

export interface SteelDevConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'yaml' | 'pretty';

export interface Session {
  id: string;
  status?: string;
  createdAt?: string;
  websocketUrl?: string;
  sessionViewerUrl?: string;
  [key: string]: unknown;
}

export interface SessionListResponse {
  sessions?: Session[];
  data?: Session[];
  [key: string]: unknown;
}

export interface CreateSessionRequest {
  sessionId?: string;
  useProxy?: boolean | { geolocation?: { country?: string } };
  solveCaptcha?: boolean;
  timeout?: number;
  inactivityTimeout?: number;
  userAgent?: string;
  credentials?: unknown;
  sessionContext?: unknown;
  [key: string]: unknown;
}

export interface SessionEvent {
  type?: string;
  timestamp?: number;
  data?: unknown;
  [key: string]: unknown;
}

export interface SessionEventsResponse {
  events?: SessionEvent[];
  data?: SessionEvent[];
  [key: string]: unknown;
}

export interface ScrapeRequest {
  url: string;
  format?: string[];
  useProxy?: boolean;
  fullPage?: boolean;
  [key: string]: unknown;
}

export interface ScrapeResponse {
  content?: Record<string, string>;
  metadata?: Record<string, unknown>;
  links?: string[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

export class SteelDevApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'SteelDevApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

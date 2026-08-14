// Zipkin Connector Types

export interface ZipkinConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ZipkinSpan {
  traceId: string;
  id: string;
  parentId?: string;
  name: string;
  timestamp: number;
  duration?: number;
  localEndpoint?: ZipkinEndpoint;
  remoteEndpoint?: ZipkinEndpoint;
  annotations?: ZipkinAnnotation[];
  tags?: Record<string, string>;
  shared?: boolean;
  debug?: boolean;
}

export interface ZipkinEndpoint {
  serviceName?: string;
  ipv4?: string;
  ipv6?: string;
  port?: number;
}

export interface ZipkinAnnotation {
  timestamp: number;
  value: string;
  endpoint?: ZipkinEndpoint;
}

export type ZipkinTrace = ZipkinSpan[];

export interface ZipkinEvent {
  id?: string;
  traceId?: string;
  spanId?: string;
  timestamp?: number;
  type?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ListTracesParams {
  serviceName?: string;
  spanName?: string;
  annotationQuery?: string;
  minDuration?: number;
  maxDuration?: number;
  endTs?: number;
  lookback?: number;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ListEventsParams {
  traceId?: string;
  spanId?: string;
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface SearchParams {
  query?: string;
  serviceName?: string;
  spanName?: string;
  annotationQuery?: string;
  minDuration?: number;
  maxDuration?: number;
  endTs?: number;
  lookback?: number;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ZipkinErrorResponse {
  message?: string;
  error?: string;
  errors?: string[];
}

export class ZipkinApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ZipkinApiError';
    this.statusCode = statusCode;
  }
}

export interface UpdownIoConfig {
  apiKey: string;
}

export interface UpdownSslInfo {
  tested_at?: string;
  expires_at?: string;
  valid?: boolean;
  error?: string | null;
}

export interface UpdownDomainInfo {
  tested_at?: string;
  expires_at?: string;
  remaining_days?: number;
  source?: string;
}

export interface UpdownCheck {
  token: string;
  url: string;
  type: string;
  alias?: string | null;
  last_status?: number | null;
  uptime?: number;
  down?: boolean;
  down_since?: string | null;
  up_since?: string | null;
  error?: string | null;
  period?: number;
  apdex_t?: number;
  string_match?: string;
  enabled?: boolean;
  published?: boolean;
  disabled_locations?: string[];
  recipients?: string[];
  last_check_at?: string | null;
  next_check_at?: string | null;
  created_at?: string;
  mute_until?: string | null;
  favicon_url?: string | null;
  custom_headers?: Record<string, string>;
  http_verb?: string;
  http_body?: string;
  ssl?: UpdownSslInfo;
  domain?: UpdownDomainInfo;
}

export interface UpdownDowntime {
  id: string;
  details_url?: string;
  error?: string;
  started_at: string;
  ended_at?: string | null;
  duration?: number;
  partial?: boolean;
}

export interface UpdownMetricsRequests {
  samples?: number;
  failures?: number;
  satisfied?: number;
  tolerated?: number;
  by_response_time?: Record<string, number>;
}

export interface UpdownMetricsTimings {
  redirect?: number;
  namelookup?: number;
  connection?: number;
  handshake?: number;
  response?: number;
  total?: number;
}

export interface UpdownMetrics {
  uptime?: number;
  apdex?: number;
  requests?: UpdownMetricsRequests;
  timings?: UpdownMetricsTimings;
  group?: string;
}

export interface UpdownNode {
  ip: string;
  ip6?: string;
  city?: string;
  country?: string;
  country_code?: string;
  lat?: number;
  lng?: number;
}

export type UpdownNodeMap = Record<string, UpdownNode>;

export class UpdownIoApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "UpdownIoApiError";
    this.statusCode = statusCode;
  }
}

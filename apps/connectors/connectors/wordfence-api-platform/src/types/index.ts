export interface WordfenceApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type VulnerabilityFeed = 'production' | 'staging';

export interface WFVulnerabilitySoftware {
  type?: string;
  slug?: string;
  name?: string;
  affected_versions?: Record<string, string>;
  patched_versions?: string[];
  remediation?: string;
}

export interface WFVulnerability {
  id?: string;
  title?: string;
  description?: string;
  published?: string;
  updated?: string;
  cve?: string | null;
  cvss?: {
    score?: number | string;
    rating?: string;
    vector?: string;
  };
  software?: WFVulnerabilitySoftware[];
  [key: string]: unknown;
}

export type WFVulnerabilityFeed = Record<string, WFVulnerability>;

export interface WFSearchOptions {
  query: string;
  feed?: VulnerabilityFeed;
  limit?: number;
  pluginSlug?: string;
  cve?: string;
}

export interface WFListEventsOptions {
  feed?: VulnerabilityFeed;
  since?: string;
  until?: string;
  limit?: number;
}

export interface RawRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | string;
  headers?: Record<string, string>;
}

export class WordfenceApiPlatformApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WordfenceApiPlatformApiError';
    this.statusCode = statusCode;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

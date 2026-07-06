import type { TalendConfig, TalendRegion } from '../types';
import { TalendApiError } from '../types';

// Talend Cloud Management Console Public API — base path is /tmc/v1.2.
// Each data-center region is served from a distinct host.
const REGION_HOSTS: Record<TalendRegion, string> = {
  us: 'https://api.us.cloud.talend.com',
  eu: 'https://api.eu.cloud.talend.com',
  ap: 'https://api.ap.cloud.talend.com',
};

const API_PATH = '/tmc/v1.2';

export interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Low-level HTTP client for the Talend Cloud Management Console Public API.
 * Handles base-URL resolution, Bearer authentication, query building, and
 * error normalization.
 */
export class TalendClient {
  private readonly token: string;
  readonly baseUrl: string;

  constructor(config: TalendConfig) {
    if (!config.token) {
      throw new Error('Talend personal access token is required');
    }
    this.token = config.token;

    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    } else {
      const region = config.region ?? 'us';
      const host = REGION_HOSTS[region];
      if (!host) {
        throw new Error(`Unknown Talend region "${region}". Expected one of: ${Object.keys(REGION_HOSTS).join(', ')}`);
      }
      this.baseUrl = `${host}${API_PATH}`;
    }
  }

  /**
   * Make an authenticated request against the Talend API.
   * `path` is relative to the resolved base URL (e.g. "/executables").
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.append(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers, signal: AbortSignal.timeout(30000) };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) return {} as T;

    const text = await response.text();
    const data = text ? safeJsonParse(text) : {};

    if (!response.ok) {
      const detail = data as { error?: string; errorCode?: string; message?: string };
      throw new TalendApiError(
        detail?.error || detail?.message || response.statusText || `HTTP ${response.status}`,
        response.status,
        detail?.errorCode,
      );
    }

    return data as T;
  }

  /** Preview of the token for display/debugging without leaking it. */
  getTokenPreview(): string {
    if (this.token.length > 10) {
      return `${this.token.substring(0, 6)}...${this.token.substring(this.token.length - 4)}`;
    }
    return '***';
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
